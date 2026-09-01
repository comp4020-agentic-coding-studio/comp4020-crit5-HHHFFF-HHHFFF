// The state machine: what phase the game is in, and the transitions between
// phases. Entity movement lives in entities.ts and knows nothing about
// phases; this file is the only place a phase actually changes, so
// window.harness (harness.ts) and real gameplay (collision.ts, main.ts) go
// through the exact same functions instead of two implementations of "you
// lost" or "the boss went down".
//
// A run is ROUNDS_TO_WIN boss rounds long and ends two ways: the third boss
// goes down and you win, or you run out of lives. The brief's spec line is
// "play ends somewhere — a win, a loss or a finish", and both terminal phases
// are set here, in the same two functions the harness drives.

import {
  addKillEnergy,
  consumeRepairPack,
  BACKGROUND_SPEED,
  type Boss,
  type Bullet,
  createBoss,
  createPlayer,
  difficultyAt,
  type Enemy,
  type Explosion,
  type ExplosionKind,
  type Player,
  type PowerUp,
  type PowerUpKind,
  ROUNDS_TO_WIN,
  type Telegraph,
} from "./entities";

export type GamePhase = "select" | "playing" | "boss" | "lost" | "won";

// Fire-and-forget notifications for the presentation layer (main.ts) to turn
// into sound, the same way it turns `state` into pixels via render.ts — kept
// as plain data so state.ts/collision.ts/step.ts never import audio.ts and
// stay DOM/Web-Audio-free for spec/*.test.ts (see CLAUDE.md: JSDOM has no
// AudioContext at all).
export type GameEvent =
  | { type: "hit" }
  | { type: "shoot" }
  | { type: "explosion"; kind: ExplosionKind }
  | { type: "boss" }
  | { type: "enrage" }
  | { type: "victory" }
  | { type: "pickup"; kind: PowerUpKind }
  | { type: "repair" };

export interface GameState {
  phase: GamePhase;
  player: Player | null;
  enemies: Enemy[];
  bullets: Bullet[];
  powerUps: PowerUp[];
  explosions: Explosion[];
  boss: Boss | null;
  progress: number;
  elapsedMs: number;
  bossesDowned: number;
  scrollY: number;
  events: GameEvent[];
  /** Counts down through the boss's arrival cutaway. While it is running the
   * boss neither moves, fires nor takes damage, and the player can still fly —
   * five seconds to reposition and read who turned up. */
  introMs: number;
  /** Paths about to be flown, drawn before they are. Owned here rather than by
   * the boss because elite wings rising from the bottom edge use them too. */
  telegraphs: Telegraph[];
}

export const BOSS_INTRO_MS = 5000;

const KILLS_TO_BOSS = 10;
/** A boss needs the meter full *and* this long since the round started. The
 * meter alone filled in about twenty seconds, which meant the elite wings
 * barely got a wave in before the arena cleared for a boss; the run is short
 * enough that the approach to a boss has to be a section of its own rather
 * than a countdown you outrun. */
export const ROUND_MIN_MS = 50000;

function createInitialState(): GameState {
  return {
    phase: "select",
    player: null,
    enemies: [],
    bullets: [],
    powerUps: [],
    explosions: [],
    boss: null,
    progress: 0,
    elapsedMs: 0,
    bossesDowned: 0,
    scrollY: 0,
    events: [],
    introMs: 0,
    telegraphs: [],
  };
}

/** Queues a fire-and-forget notification for main.ts to drain each frame. */
export function pushEvent(event: GameEvent): void {
  state.events.push(event);
}

// Kills counted separately from `progress` (a 0..1 display value derived
// from it) — summing 0.1 ten times in floating point lands on
// 0.9999999999999999, one float epsilon short of the boss threshold.
let kills = 0;
/** Milliseconds since the current round's play phase began. */
let roundMs = 0;

export const state: GameState = createInitialState();

export function resetGame(): void {
  Object.assign(state, createInitialState());
  kills = 0;
  roundMs = 0;
}

export function selectShip(shipIndex: number): void {
  state.player = createPlayer(shipIndex);
  state.enemies = [];
  state.bullets = [];
  state.powerUps = [];
  state.explosions = [];
  state.boss = null;
  state.progress = 0;
  state.elapsedMs = 0;
  state.bossesDowned = 0;
  state.phase = "playing";
  kills = 0;
  roundMs = 0;
}

/** How hard the run currently is. Everything that scales reads this rather
 * than elapsed time directly, so the ramp is defined in exactly one place. */
export function currentDifficulty(): number {
  return difficultyAt(state.elapsedMs);
}

/** Advances the run clock — and with it the difficulty. Only called while
 * play is actually happening, so a paused select screen doesn't bank time. */
export function tickClock(dtMs: number): void {
  state.elapsedMs += dtMs;
  if (state.phase !== "playing") return;
  roundMs += dtMs;
  syncProgress();
  maybeStartBoss();
}

/** The meter shows whichever requirement is further off, so a bar sitting full
 * while nothing happens can't happen. */
function syncProgress(): void {
  state.progress = Math.min(1, kills / KILLS_TO_BOSS, roundMs / ROUND_MIN_MS);
}

function maybeStartBoss(): void {
  if (kills >= KILLS_TO_BOSS && roundMs >= ROUND_MIN_MS) startBossPhase();
}

/** The backdrop keeps moving in every phase, including select: a still
 * starfield behind the ship picker looks broken, not calm. */
export function advanceScroll(dtMs: number): void {
  state.scrollY += BACKGROUND_SPEED * currentDifficulty() * (dtMs / 1000);
}

/** The one way a bullet (or the test harness) takes a life. */
export function hitPlayer(): void {
  // Terminal phases are terminal in both directions: a bullet still in the air
  // when the last boss dies must not turn a win into a loss.
  if (!state.player || state.phase === "lost" || state.phase === "won") return;
  const wasFull = state.player.lives >= state.player.maxLives;
  state.player.lives -= 1;
  pushEvent({ type: "hit" });

  // Reserve packs absorb damage taken from full health. Once the player is
  // already hurt, subsequent hits cost health normally; incoming repair drops
  // refill that health before any new packs can be stored.
  if (wasFull && consumeRepairPack(state.player)) pushEvent({ type: "repair" });

  if (state.player.lives <= 0) {
    state.phase = "lost";
  }
}

export function registerKill(): void {
  if (state.phase !== "playing") return;
  kills += 1;
  if (state.player) addKillEnergy(state.player);
  syncProgress();
  maybeStartBoss();
}

function startBossPhase(): void {
  state.phase = "boss";
  state.enemies = [];
  state.bullets = [];
  state.boss = createBoss(state.bossesDowned + 1);
  state.telegraphs = [];
  state.introMs = BOSS_INTRO_MS;
  pushEvent({ type: "boss" });
}

/** The one way the boss (or the test harness) is defeated. Rounds 1 and 2 hand
 * the run back with the meter reset and a harder boss queued behind another
 * KILLS_TO_BOSS; the third one ends it. */
export function defeatBoss(): void {
  if (state.phase !== "boss") return;
  state.boss = null;
  state.bullets = [];
  state.enemies = [];
  state.telegraphs = [];
  state.introMs = 0;
  state.bossesDowned += 1;
  kills = 0;
  roundMs = 0;
  state.progress = 0;

  if (state.bossesDowned >= ROUNDS_TO_WIN) {
    state.phase = "won";
    pushEvent({ type: "victory" });
    return;
  }
  state.phase = "playing";
}
