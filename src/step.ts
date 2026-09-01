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
  createEdgePowerUp,
  createEliteWing,
  createNormalEnemy,
  type InputState,
  randomFormation,
  randomPowerUpKind,
  updateBoss,
  updatePlayerEnergy,
  updatePlayerFiring,
  updatePlayerMovement,
} from "./entities";
import { stepBulletsAndCollisions, stepEnemyMovement, stepExplosions } from "./collision";
import { advanceScroll, currentDifficulty, pushEvent, state, tickClock } from "./state";

const IDLE_INPUT: InputState = { left: false, right: false, up: false, down: false };

let normalSpawnMs = 800;
let eventSpawnMs = 6000;
let edgePowerUpMs = 6000;

export function resetSpawnTimers(): void {
  normalSpawnMs = 800;
  eventSpawnMs = 6000;
  edgePowerUpMs = 6000;
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

  // Elite wings. These used to be a squad arcing up from the bottom edge and
  // nothing else, which made every wave the same event; they now arrive from
  // any edge in one of four shapes, hold that shape while they fire, and
  // leave. With the boss gated on ROUND_MIN_MS as well as the meter, the
  // approach to a boss is long enough for two or three of them.
  eventSpawnMs -= dtMs;
  if (eventSpawnMs <= 0) {
    eventSpawnMs = (7000 + Math.random() * 4000) / Math.min(2.5, difficulty);
    const { shape, entry } = randomFormation();
    for (const elite of createEliteWing(shape, entry, difficulty)) state.enemies.push(elite);
  }
}

function maybeDriftPowerUp(dtMs: number): void {
  if (state.phase !== "playing" && state.phase !== "boss") return;
  edgePowerUpMs -= dtMs;
  if (edgePowerUpMs <= 0) {
    // Front-loaded, then rare. The run is three rounds long, so the opening
    // minute is where a drift-in still changes how the first boss goes; after
    // that it eases back to the old spacing, which exists because the two
    // sources together used to fully upgrade a run before the ramp had bitten.
    const eased = Math.max(0, 1 - state.elapsedMs / 60000);
    const spacing = 22000 + Math.random() * 14000;
    edgePowerUpMs = spacing * (1 - 0.6 * eased);
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
      const bulletsBefore = state.bullets.length;
      updatePlayerFiring(player, dtMs, state.bullets);
      if (state.bullets.length > bulletsBefore) pushEvent({ type: "shoot" });
    }

    maybeSpawnEnemies(dtMs);
    maybeDriftPowerUp(dtMs);
    stepEnemyMovement(dtSeconds, dtMs);

    if (state.phase === "boss" && state.boss && player) {
      // The enemies array goes in as well as the bullets: the summoner's
      // charge lanes spawn ships, not shots.
      updateBoss(state.boss, dtSeconds, dtMs, state.bullets, state.enemies, player.x, player.y);
    }

    stepBulletsAndCollisions(dtSeconds, dtMs);
  }

  // Outside the phase check: a boss dying flips the phase in the same frame
  // that spawns its explosion, and the death animation should still play out.
  stepExplosions(dtMs);
}
