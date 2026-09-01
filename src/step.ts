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
  createEliteWing,
  createNormalEnemy,
  type Enemy,
  type InputState,
  type Telegraph,
  randomFormation,
  wingEntryColumns,
  randomPowerUpKind,
  updateBoss,
  updatePlayerEnergy,
  updateWeaponTimers,
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
  pendingWings = [];
}

/** A wing that has been announced but hasn't arrived yet.
 *
 * It holds the built ships, not the recipe for them. The first version stored
 * the recipe and called createEliteWing again on arrival — which re-rolls the
 * hold position, so the beams marked one column and the wing rose through
 * another. The warning has to be the same wing, not another one like it. */
interface PendingWing {
  wing: Enemy[];
  msLeft: number;
}

let pendingWings: PendingWing[] = [];

export const WING_WARNING_MS = 1200;

/** Announces a wing, then spawns it.
 *
 * Only bottom entries get the warning, and they get it because they are the
 * one arrival that comes up from behind the player --- everything else enters
 * from in front of you, where the ships themselves are the warning. The beam
 * marks the column the wing will rise through, so the dodge is available
 * before the wing is.
 */
function queueEliteWing(difficulty: number): void {
  const { shape, entry } = randomFormation();
  const wing = createEliteWing(shape, entry, difficulty);
  if (entry !== "bottom") {
    for (const elite of wing) state.enemies.push(elite);
    return;
  }
  // One beam per ship, at the column that ship will actually rise through, and
  // then *this* wing is what arrives.
  for (const x of wingEntryColumns(wing)) {
    state.telegraphs.push({ x, msLeft: WING_WARNING_MS, totalMs: WING_WARNING_MS, rising: true });
  }
  pendingWings.push({ wing, msLeft: WING_WARNING_MS });
}

function updatePendingWings(dtMs: number): void {
  if (pendingWings.length === 0) return;
  const stillWaiting: PendingWing[] = [];
  for (const pending of pendingWings) {
    pending.msLeft -= dtMs;
    if (pending.msLeft > 0) {
      stillWaiting.push(pending);
      continue;
    }
    for (const elite of pending.wing) state.enemies.push(elite);
  }
  pendingWings = stillWaiting;
}

function updateTelegraphs(dtMs: number): void {
  if (state.telegraphs.length === 0) return;
  const live: Telegraph[] = [];
  for (const lane of state.telegraphs) {
    lane.msLeft -= dtMs;
    if (lane.msLeft > 0) live.push(lane);
  }
  state.telegraphs = live;
}

function maybeSpawnEnemies(dtMs: number): void {
  if (state.phase !== "playing") return;
  const difficulty = currentDifficulty();

  normalSpawnMs -= dtMs;
  // Lowered along with the per-enemy fire rate: the patrol band shares the
  // screen with elite wings now, and fourteen patrollers plus a wing left no
  // lane open.
  const cap = Math.min(10, 3 + Math.floor(difficulty * 1.5));
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
    queueEliteWing(difficulty);
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
    // Called with the damage the player is carrying, like kill drops are. It
    // was called bare, which meant a drift-in could never be a repair — half
    // the pickups in the game were silently excluded from the one kind a
    // struggling player needs.
    state.powerUps.push(createEdgePowerUp(randomPowerUpKind(state.player)));
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
      updateWeaponTimers(player, dtMs);
      const bulletsBefore = state.bullets.length;
      updatePlayerFiring(player, dtMs, state.bullets);
      if (state.bullets.length > bulletsBefore) pushEvent({ type: "shoot" });
    }

    updateTelegraphs(dtMs);
    updatePendingWings(dtMs);
    maybeSpawnEnemies(dtMs);
    maybeDriftPowerUp(dtMs);
    stepEnemyMovement(dtSeconds, dtMs);

    // The boss's arrival cutaway. The clock, the player and the backdrop keep
    // running through it — you can fly, and you should, because the five
    // seconds are there to reposition — but the boss itself is inert and
    // collision.ts leaves it alone, so nothing resolves during a cutscene.
    if (state.introMs > 0) state.introMs = Math.max(0, state.introMs - dtMs);

    if (state.phase === "boss" && state.boss && player && state.introMs === 0) {
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
