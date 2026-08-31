import { beforeEach, describe, expect, it } from "vitest";
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
// The game is endless, so the rule under test is the boss *cycle*: the meter
// fills, a boss arrives, downing it hands the run back rather than ending it,
// and the next one is stronger. The single exit is death. An earlier version
// of this file asserted defeatBoss() reached a 'won' phase; that phase no
// longer exists, and a test still asserting it would be asserting a contract
// the game doesn't offer.
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

  it("is unwinnable: downing a boss resumes the run instead of ending it", () => {
    harness.select(0);

    killToBoss();
    expect(harness.state()).toBe("boss");
    expect(state.progress).toBe(1);

    harness.defeatBoss();
    expect(harness.state()).toBe("playing");
    expect(harness.bossesDowned()).toBe(1);
    // The meter has to reset, or the next kill would re-trigger a boss
    // immediately and the cycle would collapse.
    expect(state.progress).toBe(0);
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
