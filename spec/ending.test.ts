import { beforeEach, describe, expect, it } from "vitest";
import { installHarness } from "../src/harness";
import { registerKill, resetGame } from "../src/state";

// installHarness() assigns window.harness — vitest's default environment is
// node (this repo's other spec files reach for jsdom explicitly rather than
// running the whole suite under it), so give it a window to attach to.
(globalThis as { window?: unknown }).window = globalThis;

const harness = installHarness();

// Two spec lines, one test: "it can be lost ... play ends somewhere — a win,
// a loss or a finish" and "one rule of the game has a focused automated
// test". Both go through the exact functions a real bullet collision calls
// (state.ts), not a parallel test-only path.
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

  it("reaches 'won' once the boss is defeated", () => {
    harness.select(0);
    for (let i = 0; i < 10; i++) registerKill();
    expect(harness.state()).toBe("boss");
    harness.defeatBoss();
    expect(harness.state()).toBe("won");
  });
});
