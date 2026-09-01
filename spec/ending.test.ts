import { beforeEach, describe, expect, it } from "vitest";
import { ROUNDS_TO_WIN } from "../src/entities";
import { installHarness } from "../src/harness";
import { registerKill, resetGame, state } from "../src/state";

// installHarness() assigns window.harness — vitest's default environment is
// node (this repo's other spec files reach for jsdom explicitly rather than
// running the whole suite under it), so give it a window to attach to.
(globalThis as { window?: unknown }).window = globalThis;

const harness = installHarness();

const KILLS_TO_BOSS = 10;

function killToBoss(): void {
  for (let i = 0; i < KILLS_TO_BOSS; i++) registerKill();
}

// Two spec lines, one file: "it can be lost ... play ends somewhere — a win, a
// loss or a finish" and "one rule of the game has a focused automated test".
// Everything below goes through the exact functions a real bullet collision
// calls (state.ts), not a parallel test-only path.
//
// The rule under test is the shape of a run: three boss rounds, each meter
// fill handing over to a tougher boss, and two ways out. Downing bosses one
// and two resumes play; downing the third wins. Losing stays possible at every
// point, which is the half of the spec line a win state can quietly break.
//
// This file has now asserted the opposite twice. It once claimed a 'won' phase
// that had been removed, then claimed the game was unwinnable; the game is
// three rounds long as of this commit and the count lives in ROUNDS_TO_WIN,
// which is imported here rather than retyped, so a change to the run length
// moves this test with it instead of leaving it asserting last week's design.
describe("the game ends", () => {
  beforeEach(() => {
    resetGame();
  });

  it("reaches 'lost' after three hits", () => {
    harness.select(0);
    expect(harness.state()).toBe("playing");
    harness.hitPlayer();
    harness.hitPlayer();
    expect(harness.state()).toBe("playing");
    harness.hitPlayer();
    expect(harness.state()).toBe("lost");
    expect(harness.lives()).toBe(0);
  });

  it("hands the run back after every boss but the last", () => {
    harness.select(0);

    for (let round = 1; round < ROUNDS_TO_WIN; round++) {
      killToBoss();
      expect(harness.state()).toBe("boss");
      expect(state.progress).toBe(1);

      harness.defeatBoss();
      expect(harness.state()).toBe("playing");
      expect(harness.bossesDowned()).toBe(round);
      // The meter has to reset, or the next kill would re-trigger a boss
      // immediately and the cycle would collapse.
      expect(state.progress).toBe(0);
    }
  });

  it("is won by downing the third boss, not the first or the second", () => {
    harness.select(0);

    for (let round = 1; round <= ROUNDS_TO_WIN; round++) {
      killToBoss();
      harness.defeatBoss();
      const last = round === ROUNDS_TO_WIN;
      expect(harness.state()).toBe(last ? "won" : "playing");
    }
    expect(harness.bossesDowned()).toBe(ROUNDS_TO_WIN);
  });

  it("cannot be lost after it has been won", () => {
    harness.select(0);
    for (let round = 1; round <= ROUNDS_TO_WIN; round++) {
      killToBoss();
      harness.defeatBoss();
    }
    expect(harness.state()).toBe("won");

    // A stray bullet resolving on the same frame as the kill shot must not
    // turn a win into a loss.
    harness.hitPlayer();
    harness.hitPlayer();
    harness.hitPlayer();
    expect(harness.state()).toBe("won");
  });

  it("hands out a tougher boss each round", () => {
    harness.select(0);

    killToBoss();
    const first = harness.bossHp();
    harness.defeatBoss();

    killToBoss();
    const second = harness.bossHp();

    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  });

  it("still ends in death after a boss has been cleared", () => {
    harness.select(0);
    killToBoss();
    harness.defeatBoss();
    expect(harness.state()).toBe("playing");

    harness.hitPlayer();
    harness.hitPlayer();
    harness.hitPlayer();
    expect(harness.state()).toBe("lost");
  });
});
