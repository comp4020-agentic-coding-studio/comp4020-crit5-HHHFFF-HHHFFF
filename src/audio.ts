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

const STEPS = 16;
const SCHEDULE_AHEAD_SECONDS = 0.1;
const LOOKAHEAD_MS = 25;

const BASS_ROOT = 45; // A2
const LEAD_ROOT = 69; // A4

/** Three states of the run get three arrangements of the same riff, so the
 * music says where you are without a word on screen: cruising, a boss, and a
 * boss that has stopped holding back. All three stay in A minor pentatonic
 * (0, 3, 5, 7, 10, 12 = A C D E G A) so switching mid-run never sounds like a
 * key change --- except the enrage lead, which reaches for the flat five on
 * purpose. */
export type MusicMode = "normal" | "boss" | "enrage";

interface Arrangement {
  bpm: number;
  bass: ReadonlyArray<number | null>;
  lead: ReadonlyArray<number | null>;
  kick: ReadonlySet<number>;
  leadWave: OscillatorType;
}

const ARRANGEMENTS: Record<MusicMode, Arrangement> = {
  normal: {
    bpm: 168,
    bass: [0, null, 0, null, 7, null, 7, null, 0, null, 3, null, 5, null, 7, null],
    lead: [0, 3, 5, null, 7, 5, 3, null, 12, 10, 7, null, 5, 7, 3, null],
    kick: new Set([0, 6, 8, 14]),
    leadWave: "square",
  },
  // Boss: the bass stops resting --- a driving eighth on every step --- and
  // the lead drops to a low, sparse motif that leaves room for the kicks.
  boss: {
    bpm: 176,
    bass: [0, 0, 0, 0, 5, 5, 3, 3, 0, 0, 0, 0, 7, 7, 10, 10],
    lead: [0, null, null, 3, null, null, 5, null, 7, null, null, 5, null, 3, null, null],
    kick: new Set([0, 4, 8, 12, 14]),
    leadWave: "square",
  },
  // Enrage: half again as fast, kick on every other step, and a lead that
  // works the flat five (6) against the root for the dissonance.
  enrage: {
    bpm: 208,
    bass: [0, 0, 6, 6, 0, 0, 7, 7, 0, 0, 6, 6, 3, 3, 7, 7],
    lead: [12, 10, 7, 6, 7, 10, 12, 15, 12, 10, 7, 6, 7, 6, 3, 0],
    kick: new Set([0, 2, 4, 6, 8, 10, 12, 14]),
    leadWave: "sawtooth",
  },
};

let musicMode: MusicMode = "normal";
let arrangement = ARRANGEMENTS.normal;
let stepSeconds = 60 / arrangement.bpm / 2;

let nextStepTime = 0;
let currentStep = 0;

function scheduleStep(step: number, time: number): void {
  if (!musicGain) return;

  const bassOffset = arrangement.bass[step];
  if (bassOffset !== null && bassOffset !== undefined) {
    const freq = midiToFreq(BASS_ROOT + bassOffset);
    playTone("triangle", freq, freq, time, stepSeconds * 1.8, 0.5, musicGain);
  }

  const leadOffset = arrangement.lead[step];
  if (leadOffset !== null && leadOffset !== undefined) {
    const freq = midiToFreq(LEAD_ROOT + leadOffset);
    playTone(arrangement.leadWave, freq, freq, time, stepSeconds * 0.85, 0.2, musicGain);
  }

  // Soft hat every step, harder kick on the syncopated subset --- the pulse
  // that gives the loop its "space battle" drive under the riff.
  playNoiseBurst("highpass", 6000, 6000, time, 0.045, 0.035, musicGain);
  if (arrangement.kick.has(step)) {
    playNoiseBurst("lowpass", 500, 60, time, 0.16, 0.32, musicGain);
  }
}

function scheduler(): void {
  if (!ctx) return;
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_SECONDS) {
    scheduleStep(currentStep, nextStepTime);
    nextStepTime += stepSeconds;
    currentStep = (currentStep + 1) % STEPS;
    // Swapping at the top of the loop rather than mid-bar: a tempo change on
    // step 7 sounds like a dropped beat, the same change on step 0 sounds
    // like the next section starting.
    if (currentStep === 0) applyPendingMode();
  }
  schedulerHandle = window.setTimeout(scheduler, LOOKAHEAD_MS);
}

let pendingMode: MusicMode | null = null;

function applyPendingMode(): void {
  if (pendingMode === null) return;
  musicMode = pendingMode;
  pendingMode = null;
  arrangement = ARRANGEMENTS[musicMode];
  stepSeconds = 60 / arrangement.bpm / 2;
}

/** Queues an arrangement change for the top of the next loop. Safe before
 * initAudio(): it just records the mode, and the loop starts on it. */
export function setMusicMode(mode: MusicMode): void {
  if (mode === musicMode && pendingMode === null) return;
  pendingMode = mode;
  // Nothing is scheduling yet, so there is no "next bar" to wait for.
  if (!ctx) applyPendingMode();
}

export function currentMusicMode(): MusicMode {
  return musicMode;
}

/** Two low blasts as a boss arrives. The arrangement swap underneath it only
 * lands at the top of the next bar, up to a couple of seconds away, so this is
 * what makes the change audible *now* --- the music then confirms it. */
export function playBossHorn(): void {
  if (!ctx || !sfxGain) return;
  const time = ctx.currentTime;
  for (const [i, note] of [33, 36].entries()) {
    const freq = midiToFreq(note);
    playTone("sawtooth", freq, freq * 0.97, time + i * 0.26, 0.4, 0.5, sfxGain);
  }
  playNoiseBurst("lowpass", 900, 60, time, 0.55, 0.35, sfxGain);
}

/** Picking something up. Repair gets its own shape --- a rising pair rather
 * than a single blip --- because it is the only pickup that isn't a gun. */
export function playPickup(repair: boolean): void {
  if (!ctx || !sfxGain) return;
  const time = ctx.currentTime;
  if (repair) {
    for (const [i, offset] of [7, 12, 16].entries()) {
      const freq = midiToFreq(LEAD_ROOT + offset);
      playTone("triangle", freq, freq, time + i * 0.07, 0.2, 0.3, sfxGain);
    }
    return;
  }
  playTone("square", midiToFreq(LEAD_ROOT + 7), midiToFreq(LEAD_ROOT + 14), time, 0.14, 0.22, sfxGain);
}

/** A rising arpeggio for clearing the third boss --- the run's only win, so
 * it gets the one sound that is not a weapon or an explosion. */
export function playVictory(): void {
  if (!ctx || !sfxGain) return;
  const time = ctx.currentTime;
  const notes = [0, 4, 7, 12, 16, 19, 24];
  for (const [i, offset] of notes.entries()) {
    const freq = midiToFreq(LEAD_ROOT + offset);
    playTone("square", freq, freq, time + i * 0.09, 0.34, 0.24, sfxGain);
  }
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
