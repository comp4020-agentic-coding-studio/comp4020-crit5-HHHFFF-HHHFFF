import { beforeEach, describe, expect, it } from "vitest";
import {
  addKillEnergy,
  createPlayer,
  difficultyAt,
  OVERDRIVE_MS,
  RAMP_MS,
  updatePlayerEnergy,
} from "../src/entities";
import { installHarness } from "../src/harness";
import { currentDifficulty, resetGame, state } from "../src/state";

(globalThis as { window?: unknown }).window = globalThis;

const harness = installHarness();

/** Advances the run through the same per-frame function main.ts's
 * requestAnimationFrame loop calls. */
function play(seconds: number): void {
  harness.step(Math.round((seconds * 1000) / 16), 16);
}

/** Keeps a run alive for as long as a measurement needs.
 *
 * The ramp is what these tests are about, not the player's survival — and a
 * dead player stops the clock, which freezes difficulty, spawning and every
 * counter along with it. The first version of the fire-density test below
 * didn't do this, sat still for 150 seconds, died at about 15, and then
 * compared two frozen snapshots taken after death. It passed on luck. */
function keepAlive(): void {
  if (state.player) state.player.lives = 100_000;
}

/** Counts every enemy bullet that appears over a window of play.
 *
 * Deliberately not `probe().enemyBullets`, which is how many happen to be
 * alive in the one frame you look. Two things make that a coin flip rather
 * than a measurement: a boss fight suppresses normal spawns entirely
 * (`maybeSpawnEnemies` returns early unless the phase is "playing"), and
 * `defeatBoss()` clears `state.bullets` outright — so a snapshot that lands
 * just after a boss dies legitimately reads 0 on a run that is in fact far
 * busier than it was at 20 seconds. Measured over 40 runs the snapshot
 * version failed 3 times (late 0 vs early 8, late 0 vs early 6, late 12 vs
 * early 14): a ~7% flake, which is what turned `pnpm check` red on a commit
 * that had changed nothing it measures.
 *
 * Counting distinct bullets across a window averages those boss phases in
 * instead of landing inside one. Identity works as the key because bullets
 * are freshly constructed objects — entities.ts pools nothing. */
function enemyFireOver(seconds: number): number {
  const seen = new WeakSet<object>();
  let total = 0;
  const frames = Math.round((seconds * 1000) / 16);
  for (let i = 0; i < frames; i++) {
    harness.step(1, 16);
    for (const bullet of state.bullets) {
      if (bullet.owner !== "enemy" || seen.has(bullet)) continue;
      seen.add(bullet);
      total += 1;
    }
  }
  return total;
}

// The endless mode's whole promise is that standing still gets harder, and
// none of that is visible to a rendered check: headless Chrome runs roughly
// one animation frame per second of virtual time, so "is it busier at three
// minutes" can't be asked of a screenshot at all.
describe("the endless ramp", () => {
  beforeEach(() => {
    resetGame();
  });

  it("is a pure function of elapsed time, with no ceiling", () => {
    expect(difficultyAt(0)).toBe(1);
    expect(difficultyAt(RAMP_MS)).toBe(2);
    expect(difficultyAt(RAMP_MS * 9)).toBe(10);
  });

  // The ramp's own sensor. `currentDifficulty()` is `difficultyAt(elapsedMs)`,
  // so what this pins down that the pure-function test above doesn't is the
  // wiring: that a run's clock actually advances and actually feeds the ramp.
  // Flattening difficultyAt to `return 1` turns this red (4.0 -> 1.0) and,
  // notably, turns nothing else in this file red — see the fire test below.
  it("climbs with the run clock, so standing still gets harder", () => {
    harness.select(0);
    keepAlive();
    play(120);

    const elapsed = harness.probe().elapsedMs;
    expect(elapsed).toBeGreaterThan(115_000);
    expect(currentDifficulty()).toBeCloseTo(difficultyAt(elapsed), 10);
    expect(currentDifficulty()).toBeGreaterThan(3.5);
  });

  // Deliberately NOT sold as a ramp check, because it isn't one: flattening
  // difficultyAt to a constant leaves it green 40/40. A late run is busier
  // than an early one mostly because power-ups have accumulated, so the player
  // kills faster, so boss rounds come round more often — and bosses fire
  // densely. What this does sense is a run going quiet: spawning breaking,
  // fire stopping, the field emptying out and never refilling.
  //
  // Both windows are 60s and both start from steady state (the first one after
  // a 30s warm-up), because the earlier version compared a 20s window on a
  // still-filling field against a 20s window 130s in, which mostly measured
  // how long an empty arena takes to fill. Over 40 runs: early 172-295, late
  // 495-1261, closest margin 200.
  it("keeps a late run busier than an early one", () => {
    harness.select(0);
    keepAlive();
    play(30);
    const early = enemyFireOver(60);

    resetGame();
    harness.select(0);
    keepAlive();
    play(300);
    const late = enemyFireOver(60);

    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early);
  });

  it("scrolls the backdrop, faster as the run goes on", () => {
    harness.select(0);
    keepAlive();
    play(10);
    const firstTenSeconds = harness.probe().scrollY;

    play(140);
    const before = harness.probe().scrollY;
    play(10);
    const lastTenSeconds = harness.probe().scrollY - before;

    expect(firstTenSeconds).toBeGreaterThan(0);
    expect(lastTenSeconds).toBeGreaterThan(firstTenSeconds);
  });

  it("ends a run that does nothing, rather than running forever", () => {
    // No keepAlive() here: this is the ramp's side of the bargain. A player
    // who never moves has to lose, or "endless" would just mean "idle".
    harness.select(0);
    let frames = 0;
    const guard = (10 * 60 * 1000) / 16; // ten minutes of play
    while (harness.state() !== "lost" && frames < guard) {
      harness.step(1, 16);
      frames += 1;
    }
    expect(harness.state()).toBe("lost");
    expect(frames).toBeLessThan(guard);
  });

  it("keeps patrolling enemies out of the player's half while they wander", () => {
    harness.select(0);
    keepAlive();
    play(40);

    const patrolling = state.enemies.filter((enemy) => enemy.kind === "normal");
    expect(patrolling.length).toBeGreaterThan(0);
    for (const enemy of patrolling) {
      expect(enemy.y).toBeLessThanOrEqual(state.player?.y ?? 0);
    }
  });
});

// The meter is pure logic on the player, so it's tested directly rather than
// through a run — a run would have to survive long enough to fill it, which
// makes the test about survival instead of about the meter.
describe("the energy meter", () => {
  it("fills on its own, buys a fixed burst of laser, then empties", () => {
    const player = createPlayer(0);
    expect(player.energy).toBe(0);
    expect(player.overdriveMs).toBe(0);

    let elapsed = 0;
    while (player.overdriveMs === 0 && elapsed < 120_000) {
      updatePlayerEnergy(player, 16);
      elapsed += 16;
    }
    // Long enough to be a reward for surviving, short enough to see twice in
    // a decent run.
    expect(elapsed).toBeGreaterThan(30_000);
    expect(elapsed).toBeLessThan(60_000);
    expect(player.overdriveMs).toBe(OVERDRIVE_MS);

    for (let i = 0; i < OVERDRIVE_MS / 16 + 2; i++) updatePlayerEnergy(player, 16);
    expect(player.overdriveMs).toBe(0);
    expect(player.energy).toBeLessThan(0.05);
  });

  it("fills faster when you are killing things", () => {
    const idle = createPlayer(0);
    const busy = createPlayer(0);
    for (let i = 0; i < 60; i++) {
      updatePlayerEnergy(idle, 16);
      updatePlayerEnergy(busy, 16);
    }
    for (let i = 0; i < 5; i++) addKillEnergy(busy);

    expect(busy.energy).toBeGreaterThan(idle.energy);
  });

  it("banks nothing mid-burst, so overdrive can't chain into itself", () => {
    const player = createPlayer(0);
    player.overdriveMs = OVERDRIVE_MS;
    player.energy = 0;
    for (let i = 0; i < 20; i++) addKillEnergy(player);

    expect(player.energy).toBe(0);
  });
});
