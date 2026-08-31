// One frame of simulation: everything that moves the world, with no canvas
// and no requestAnimationFrame. main.ts calls this and then draws;
// window.harness.step() calls it in a loop.
//
// That second caller is the point. Headless Chrome runs rAF roughly once per
// second of virtual time, so anything frame-driven is invisible to a
// screenshot check — and CLAUDE.md's answer is a seam that steps the same
// state the visitor sees rather than a parallel copy of it. Because both
// callers land here, "a frame" has exactly one definition.
//
// Deliberately imports no canvas and no assets, so this module (and therefore
// harness.ts, and therefore the spec tests) stays DOM-free.

import {
  ARENA_WIDTH,
  createEdgePowerUp,
  createEventSquadMember,
  createNormalEnemy,
  type InputState,
  randomPowerUpKind,
  updateBoss,
  updatePlayerEnergy,
  updatePlayerFiring,
  updatePlayerMovement,
} from "./entities";
import { stepBulletsAndCollisions, stepEnemyMovement, stepExplosions } from "./collision";
import { advanceScroll, currentDifficulty, state, tickClock } from "./state";

const IDLE_INPUT: InputState = { left: false, right: false, up: false, down: false };

let normalSpawnMs = 800;
let eventSpawnMs = 6000;
let edgePowerUpMs = 16000;

export function resetSpawnTimers(): void {
  normalSpawnMs = 800;
  eventSpawnMs = 6000;
  edgePowerUpMs = 16000;
}

function maybeSpawnEnemies(dtMs: number): void {
  if (state.phase !== "playing") return;
  const difficulty = currentDifficulty();

  normalSpawnMs -= dtMs;
  const cap = Math.min(14, 4 + Math.floor(difficulty * 2));
  if (normalSpawnMs <= 0 && state.enemies.filter((enemy) => enemy.kind === "normal").length < cap) {
    normalSpawnMs = (900 + Math.random() * 500) / Math.min(3.5, difficulty);
    state.enemies.push(createNormalEnemy(difficulty));
  }

  eventSpawnMs -= dtMs;
  if (eventSpawnMs <= 0) {
    eventSpawnMs = (9000 + Math.random() * 6000) / Math.min(2.5, difficulty);
    const startX = Math.random() < 0.5 ? ARENA_WIDTH * 0.3 : ARENA_WIDTH * 0.7;
    const squad = Math.min(7, 4 + Math.floor(difficulty - 1));
    for (let i = 0; i < squad; i++) state.enemies.push(createEventSquadMember(i, startX, difficulty));
  }
}

function maybeDriftPowerUp(dtMs: number): void {
  if (state.phase !== "playing" && state.phase !== "boss") return;
  edgePowerUpMs -= dtMs;
  if (edgePowerUpMs <= 0) {
    // Rare on purpose: the drift-in is a bonus on top of kill drops, and the
    // two together used to fully upgrade a run before the ramp had bitten.
    edgePowerUpMs = 22000 + Math.random() * 14000;
    state.powerUps.push(createEdgePowerUp(randomPowerUpKind()));
  }
}

export function stepWorld(dtMs: number, input: InputState = IDLE_INPUT): void {
  const dtSeconds = dtMs / 1000;

  // The backdrop drifts in every phase, select included: a frozen starfield
  // behind the ship picker reads as a broken page, not a calm one.
  advanceScroll(dtMs);

  if (state.phase === "playing" || state.phase === "boss") {
    tickClock(dtMs);

    const player = state.player;
    if (player) {
      updatePlayerMovement(player, input, dtSeconds);
      updatePlayerEnergy(player, dtMs);
      updatePlayerFiring(player, dtMs, state.bullets);
    }

    maybeSpawnEnemies(dtMs);
    maybeDriftPowerUp(dtMs);
    stepEnemyMovement(dtSeconds, dtMs);

    if (state.phase === "boss" && state.boss && player) {
      updateBoss(state.boss, dtSeconds, dtMs, state.bullets, player.x, player.y);
    }

    stepBulletsAndCollisions(dtSeconds, dtMs);
  }

  // Outside the phase check: a boss dying flips the phase in the same frame
  // that spawns its explosion, and the death animation should still play out.
  stepExplosions(dtMs);
}
