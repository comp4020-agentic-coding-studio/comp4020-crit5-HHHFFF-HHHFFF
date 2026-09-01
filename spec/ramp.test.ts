import { beforeEach, describe, expect, it } from "vitest";
import {
  addKillEnergy,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  type InputState,
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
 * counter along with it. The first version of the fire-density test in this
 * file didn't do this, sat still for 150 seconds, died at about 15, and then
 * compared two frozen snapshots taken after death. It passed on luck. */
function keepAlive(): void {
  if (state.player) state.player.lives = 100_000;
}

// This file was spec/endless.test.ts, and the run it tested no longer exists:
// the game is three boss rounds and then a win, so "a late run" tops out at
// about a hundred seconds. Two of its tests went red on exactly that, which is
// the right failure — they were asserting last week's design.
//
// What survives is the ramp itself, which still climbs with the clock inside a
// run. What replaces the "a late run is busier" check is a sensor for the
// brief's actual promise: "a stranger can pick it up and reach an ending
// inside five minutes". That check was already known not to sense the ramp
// (flattening difficultyAt left it green 40/40 — see CLAUDE.md, "Verify a
// check by breaking what it names"), so it is not a loss.
describe("the difficulty ramp", () => {
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
  // Flattening difficultyAt to `return 1` turns this red (2.5 -> 1.0).
  //
  // 60 seconds, not the 120 it used to be: a run now ends, and an immortal
  // idle player wins at around a hundred seconds, so a longer horizon would be
  // measuring a stopped clock.
  it("climbs with the run clock, so standing still gets harder", () => {
    harness.select(0);
    keepAlive();
    play(60);

    const elapsed = harness.probe().elapsedMs;
    expect(elapsed).toBeGreaterThan(58_000);
    expect(currentDifficulty()).toBeCloseTo(difficultyAt(elapsed), 10);
    expect(currentDifficulty()).toBeGreaterThan(2.2);
  });

  it("scrolls the backdrop, faster as the run goes on", () => {
    harness.select(0);
    keepAlive();
    play(10);
    const firstTenSeconds = harness.probe().scrollY;

    play(60);
    const before = harness.probe().scrollY;
    play(10);
    const lastTenSeconds = harness.probe().scrollY - before;

    expect(firstTenSeconds).toBeGreaterThan(0);
    expect(lastTenSeconds).toBeGreaterThan(firstTenSeconds);
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

// "a stranger can pick it up and reach an ending inside five minutes" is a
// spec line, and it is the one that boss health directly threatens: the three
// rounds are 120 / 240 / 360 hp against a base 5.6 dps, and it would be easy
// to tune that into a fifteen-minute slog without noticing, because every
// individual round would still feel fine.
describe("a run reaches an ending", () => {
  beforeEach(() => {
    resetGame();
  });

  /** A ship that flies toward the nearest pickup and otherwise holds station.
   *
   * The probe used to sit perfectly still, which stopped being a useful stand-
   * in the moment the branch shot and the multiplier became timed: a ship that
   * never moves collects almost nothing, so it was measuring a run with no
   * upgrades at all rather than a run played by a person. It doesn't dodge —
   * that is what `immortal` is for — but it does the one thing every player
   * does that decides how fast a boss dies, and it does it through the same
   * InputState a held key produces. */
  function collectorInput(): InputState {
    const player = state.player;
    if (!player) return { left: false, right: false, up: false, down: false };

    let target: { x: number; y: number } | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const powerUp of state.powerUps) {
      const distance = Math.hypot(powerUp.x - player.x, powerUp.y - player.y);
      if (distance < best) {
        best = distance;
        target = powerUp;
      }
    }
    // With nothing to fetch, drift back to the bottom middle.
    const goalX = target ? target.x : ARENA_WIDTH / 2;
    const goalY = target ? target.y : ARENA_HEIGHT - 90;
    return {
      left: player.x - goalX > 6,
      right: goalX - player.x > 6,
      up: player.y - goalY > 6,
      down: goalY - player.y > 6,
    };
  }

  /** Steps until the run ends, and reports how long that took. */
  function runToEnd(immortal: boolean): { phase: string; seconds: number } {
    harness.select(0);
    if (immortal) keepAlive();
    const guard = (10 * 60 * 1000) / 16;
    let frames = 0;
    while (harness.state() !== "lost" && harness.state() !== "won" && frames < guard) {
      harness.step(1, 16, immortal ? collectorInput() : undefined);
      frames += 1;
    }
    return { phase: harness.state(), seconds: (frames * 16) / 1000 };
  }

  it("wins inside five minutes for a player who survives", () => {
    // The probe flies to pickups but never dodges and never dies, so this
    // measures the damage budget — 720hp of boss, three meters of trash, and
    // whatever the gun is worth with buffs that expire — not human skill. It
    // lands at 195-215s; the bound is the spec's five minutes because a real
    // player, who does dodge, is slower.
    const { phase, seconds } = runToEnd(true);

    expect(phase).toBe("won");
    expect(seconds).toBeLessThan(300);
    // And not so fast that three rounds are over before they register.
    expect(seconds).toBeGreaterThan(45);
  });

  it("ends a run that does nothing, rather than running forever", () => {
    // No keepAlive(): a player who never moves has to lose. Auto-fire means
    // they still make progress, so this is also the check that a passive run
    // can't stumble into the win.
    const { phase } = runToEnd(false);
    expect(phase).toBe("lost");
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
