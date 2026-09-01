// The state machine: what phase the game is in, and the transitions between
// phases. Entity movement lives in entities.ts and knows nothing about
// phases; this file is the only place a phase actually changes, so
// window.harness (harness.ts) and real gameplay (collision.ts, main.ts) go
// through the exact same functions instead of two implementations of "you
// lost" or "the boss went down".
//
// Endless mode: there is no winning phase. The boss is a recurring wave, not
// a finish line — downing it banks the round and drops straight back into
// play with everything a notch harder. The run ends exactly one way.

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
} from "./entities";

export type GamePhase = "select" | "playing" | "boss" | "lost";

// Fire-and-forget notifications for the presentation layer (main.ts) to turn
// into sound, the same way it turns `state` into pixels via render.ts — kept
// as plain data so state.ts/collision.ts/step.ts never import audio.ts and
// stay DOM/Web-Audio-free for spec/*.test.ts (see CLAUDE.md: JSDOM has no
// AudioContext at all).
export type GameEvent = { type: "hit" } | { type: "shoot" } | { type: "explosion"; kind: ExplosionKind };

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
  if (!state.player || state.phase === "lost") return;
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
}

/** The one way the boss (or the test harness) is defeated. In endless mode
 * that is a wave cleared, not a run won: the meter resets and the next boss
 * is already queued up behind another KILLS_TO_BOSS. */
export function defeatBoss(): void {
  if (state.phase !== "boss") return;
  state.boss = null;
  state.bullets = [];
  state.bossesDowned += 1;
  kills = 0;
  state.progress = 0;
  state.phase = "playing";
}
