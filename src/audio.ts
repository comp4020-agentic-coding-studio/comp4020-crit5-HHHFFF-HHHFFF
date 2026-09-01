// Procedural 8-bit/chiptune audio: no asset files, no audio library --- every
// sound here is an oscillator or a shared noise buffer, shaped with gain and
// filter envelopes at runtime. This is the ONLY module in the game that
// touches AudioContext: entities.ts/collision.ts/step.ts/state.ts stay
// DOM/Web-Audio-free (per CLAUDE.md) so spec/*.test.ts keeps exercising them
// under vitest's JSDOM, which has no AudioContext at all. Every exported
// function here defensively no-ops until initAudio() has actually created
// one, so importing this module can never throw under JSDOM even by
// accident, and browsers that block audio before a user gesture just sit
// silent instead of erroring.

import type { ExplosionKind } from "./entities";

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let engineGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let schedulerHandle: number | null = null;

let muted = false;
const MASTER_LEVEL = 0.55;

/** A4 = MIDI 69 = 440Hz. Kept pure and AudioContext-free so it's directly
 * testable under vitest (spec/audio.test.ts). */
export function midiToFreq(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function makeNoiseBuffer(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A short envelope-shaped oscillator tone: fast linear attack (avoids a
 * click), exponential decay to silence, auto-stops itself. */
function playTone(
  type: OscillatorType,
  freqStart: number,
  freqEnd: number,
  time: number,
  duration: number,
  peak: number,
  destination: AudioNode,
): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, freqStart), time);
  if (freqEnd !== freqStart) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), time + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peak, time + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(time);
  osc.stop(time + duration + 0.02);
}

/** A burst of the shared noise buffer through a swept filter --- the 8-bit
 * way to get percussion and explosions without a drum sample. */
function playNoiseBurst(
  filterType: BiquadFilterType,
  freqStart: number,
  freqEnd: number,
  time: number,
  duration: number,
  peak: number,
  destination: AudioNode,
): void {
  if (!ctx || !noiseBuffer) return;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freqStart, time);
  if (freqEnd !== freqStart) filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), time + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(time);
  source.stop(time + duration + 0.02);
}

// ---------- the loop: an arcade space-battle chiptune riff ----------
//
// 16 steps of 8th notes (2 bars of 4/4) at a driving tempo. Bass and lead
// are semitone offsets from their own root (null = rest); percussion is
// two noise bursts (a low "kick" on a syncopated subset of steps, a soft
// high "hat" on every step) sharing the one noise buffer.

const BPM = 168;
const STEP_SECONDS = 60 / BPM / 2;
const STEPS = 16;
const SCHEDULE_AHEAD_SECONDS = 0.1;
const LOOKAHEAD_MS = 25;

const BASS_ROOT = 45; // A2
const LEAD_ROOT = 69; // A4

// A-minor-pentatonic offsets (0, 3, 5, 7, 10, 12 = A C D E G A) throughout,
// so bass and lead always land in key no matter which step plays.
const BASS_PATTERN: ReadonlyArray<number | null> = [
  0, null, 0, null, 7, null, 7, null, 0, null, 3, null, 5, null, 7, null,
];
const LEAD_PATTERN: ReadonlyArray<number | null> = [
  0, 3, 5, null, 7, 5, 3, null, 12, 10, 7, null, 5, 7, 3, null,
];
const KICK_STEPS = new Set([0, 6, 8, 14]);

let nextStepTime = 0;
let currentStep = 0;

function scheduleStep(step: number, time: number): void {
  if (!musicGain) return;

  const bassOffset = BASS_PATTERN[step];
  if (bassOffset !== null) {
    playTone("triangle", midiToFreq(BASS_ROOT + bassOffset), midiToFreq(BASS_ROOT + bassOffset), time, STEP_SECONDS * 1.8, 0.5, musicGain);
  }

  const leadOffset = LEAD_PATTERN[step];
  if (leadOffset !== null) {
    playTone("square", midiToFreq(LEAD_ROOT + leadOffset), midiToFreq(LEAD_ROOT + leadOffset), time, STEP_SECONDS * 0.85, 0.2, musicGain);
  }

  // Soft hat every step, harder kick on the syncopated subset --- the pulse
  // that gives the loop its "space battle" drive under the riff.
  playNoiseBurst("highpass", 6000, 6000, time, 0.045, 0.035, musicGain);
  if (KICK_STEPS.has(step)) {
    playNoiseBurst("lowpass", 500, 60, time, 0.16, 0.32, musicGain);
  }
}

function scheduler(): void {
  if (!ctx) return;
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_SECONDS) {
    scheduleStep(currentStep, nextStepTime);
    nextStepTime += STEP_SECONDS;
    currentStep = (currentStep + 1) % STEPS;
  }
  schedulerHandle = window.setTimeout(scheduler, LOOKAHEAD_MS);
}

function startMusic(): void {
  if (!ctx || schedulerHandle !== null) return;
  currentStep = 0;
  nextStepTime = ctx.currentTime + 0.05;
  scheduler();
}

// ---------- lifecycle ----------

/** Creates the AudioContext and starts the music loop. Idempotent, and safe
 * to call from any user-gesture handler (browsers refuse to make sound
 * before one) --- calling it twice, or calling it where AudioContext isn't
 * defined at all (JSDOM), is a no-op either way. */
export function initAudio(): void {
  if (ctx) return;
  // spec/*.test.ts run under vitest's default Node environment --- no
  // `window` at all, let alone AudioContext --- so this has to bail before
  // even reading the global, not just before constructing the context.
  if (typeof window === "undefined") return;
  const AudioContextCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;

  ctx = new AudioContextCtor();
  noiseBuffer = makeNoiseBuffer(ctx);

  masterGain = ctx.createGain();
  masterGain.gain.value = muted ? 0 : MASTER_LEVEL;
  masterGain.connect(ctx.destination);

  musicGain = ctx.createGain();
  musicGain.gain.value = 0.5;
  musicGain.connect(masterGain);

  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.9;
  sfxGain.connect(masterGain);

  engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engineGain.connect(masterGain);

  const engineFilter = ctx.createBiquadFilter();
  engineFilter.type = "lowpass";
  engineFilter.frequency.value = 260;
  engineFilter.connect(engineGain);

  const engineOsc = ctx.createOscillator();
  engineOsc.type = "sawtooth";
  engineOsc.frequency.value = 52;
  engineOsc.connect(engineFilter);
  engineOsc.start();

  startMusic();
}

// ---------- sound effects ----------

/** One shot per player bullet actually fired. */
export function playShoot(): void {
  if (!ctx || !sfxGain) return;
  playTone("square", 900, 260, ctx.currentTime, 0.09, 0.25, sfxGain);
}

/** Filtered noise "boom" plus a pitch-drop tone underneath --- boss version
 * is bigger, lower and louder than a rank-and-file enemy's. */
export function playExplosion(kind: ExplosionKind): void {
  if (!ctx || !sfxGain) return;
  const time = ctx.currentTime;
  const big = kind === "boss";
  playNoiseBurst("lowpass", big ? 2400 : 3200, big ? 80 : 150, time, big ? 0.6 : 0.32, big ? 0.85 : 0.55, sfxGain);
  playTone("square", big ? 160 : 220, big ? 40 : 60, time, big ? 0.55 : 0.3, big ? 0.6 : 0.45, sfxGain);
}

/** A short two-note descending buzz for the player losing a life --- a
 * warning tone, deliberately not the noise-based explosion timbre, so a hit
 * never reads as a kill. */
export function playHit(): void {
  if (!ctx || !sfxGain) return;
  const time = ctx.currentTime;
  playTone("square", midiToFreq(64), midiToFreq(64), time, 0.09, 0.32, sfxGain);
  playTone("square", midiToFreq(60), midiToFreq(60), time + 0.08, 0.16, 0.32, sfxGain);
}

/** The "flying" sound: a continuous low engine hum whose volume tracks
 * whether the ship is actually thrusting, ramped rather than stepped so it
 * swells and fades instead of clicking on/off. `level` is 0..1. */
export function setEngineIntensity(level: number): void {
  if (!ctx || !engineGain) return;
  const target = Math.max(0, Math.min(1, level)) * 0.06;
  engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
}

// ---------- mute ----------

export function isMuted(): boolean {
  return muted;
}

/** Flips mute and returns the new state. Safe before initAudio() has run ---
 * it just records the flag, applied the moment the context is created. */
export function toggleMute(): boolean {
  muted = !muted;
  if (ctx && masterGain) masterGain.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, ctx.currentTime, 0.05);
  return muted;
}
