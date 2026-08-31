// The state machine: what phase the game is in, and the transitions between
// phases. Entity movement lives in entities.ts and knows nothing about
// phases; this file is the only place a phase actually changes, so
// window.harness (harness.ts) and real gameplay (collision.ts, main.ts) go
// through the exact same functions instead of two implementations of "you
// lost" or "you won".

import {
  type Boss,
  type Bullet,
  type Enemy,
  createBoss,
  createPlayer,
  type Explosion,
  type Player,
  type PowerUp,
} from "./entities";

export type GamePhase = "select" | "playing" | "boss" | "won" | "lost";

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
  };
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
  state.phase = "playing";
  kills = 0;
}

/** The one way a bullet (or the test harness) takes a life. */
export function hitPlayer(): void {
  if (!state.player || state.phase === "won" || state.phase === "lost") return;
  state.player.lives -= 1;
  if (state.player.lives <= 0) {
    state.phase = "lost";
  }
}

export function registerKill(): void {
  if (state.phase !== "playing") return;
  kills += 1;
  state.progress = Math.min(1, kills / KILLS_TO_BOSS);
  if (kills >= KILLS_TO_BOSS) startBossPhase();
}

function startBossPhase(): void {
  state.phase = "boss";
  state.enemies = [];
  state.bullets = [];
  state.boss = createBoss();
}

/** The one way the boss (or the test harness) is defeated. */
export function defeatBoss(): void {
  if (state.phase !== "boss") return;
  state.boss = null;
  state.bullets = [];
  state.phase = "won";
}
