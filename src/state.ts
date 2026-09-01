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
  ROUNDS_TO_WIN,
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
  | { type: "victory" };

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
}

const KILLS_TO_BOSS = 10;

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

export const state: GameState = createInitialState();

export function resetGame(): void {
  Object.assign(state, createInitialState());
  kills = 0;
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
  state.player.lives -= 1;
  pushEvent({ type: "hit" });
  if (state.player.lives <= 0) {
    state.phase = "lost";
  }
}

export function registerKill(): void {
  if (state.phase !== "playing") return;
  kills += 1;
  state.progress = Math.min(1, kills / KILLS_TO_BOSS);
  if (state.player) addKillEnergy(state.player);
  if (kills >= KILLS_TO_BOSS) startBossPhase();
}

function startBossPhase(): void {
  state.phase = "boss";
  state.enemies = [];
  state.bullets = [];
  state.boss = createBoss(state.bossesDowned + 1);
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
  state.bossesDowned += 1;
  kills = 0;
  state.progress = 0;

  if (state.bossesDowned >= ROUNDS_TO_WIN) {
    state.phase = "won";
    pushEvent({ type: "victory" });
    return;
  }
  state.phase = "playing";
}
