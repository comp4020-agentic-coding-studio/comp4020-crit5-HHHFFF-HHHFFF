// window.harness: the seam spec/ending.test.ts and manual "see the rendered
// page" checks drive. Every method calls straight into state.ts's own
// transition functions — the same ones a real bullet collision calls — so a
// passing test proves the real path works, not a parallel test-only one.

import { defeatBoss, hitPlayer, selectShip, state } from "./state";

export interface Harness {
  state(): string;
  select(shipIndex: number): void;
  hitPlayer(): void;
  defeatBoss(): void;
  lives(): number;
}

export function installHarness(): Harness {
  const harness: Harness = {
    state: () => state.phase,
    select: (shipIndex: number) => selectShip(shipIndex),
    hitPlayer: () => hitPlayer(),
    defeatBoss: () => defeatBoss(),
    lives: () => state.player?.lives ?? 0,
  };
  (window as unknown as { harness: Harness }).harness = harness;
  return harness;
}
