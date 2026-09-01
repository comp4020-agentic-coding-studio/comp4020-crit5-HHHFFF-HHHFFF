// window.harness: the seam spec/*.test.ts and manual "see the rendered page"
// checks drive. Every method calls straight into state.ts's own transition
// functions, or step.ts's own frame function — the same ones a real bullet
// collision and a real animation frame call — so a passing test proves the
// real path works, not a parallel test-only one.

import {
  advanceBossPhase,
  applyPowerUp,
  bossBarIndex,
  type InputState,
  OVERDRIVE_MS,
  type PowerUpKind,
} from "./entities";
import { defeatBoss, hitPlayer, registerKill, selectShip, state } from "./state";
import { resetSpawnTimers, stepWorld } from "./step";

export interface Harness {
  state(): string;
  select(shipIndex: number): void;
  hitPlayer(): void;
  /** Credits one kill towards the boss meter — the same function collision.ts
   * calls when an enemy's hp hits zero, so ten of these reach the boss the
   * way ten real kills would. */
  registerKill(): void;
  defeatBoss(): void;
  /** Takes `amount` off the boss and lets it react — the same two steps
   * collision.ts runs when a player bullet lands, so a bar break, an enrage or
   * a split reached this way is the real one, not a flag set by hand. */
  damageBoss(amount: number): void;
  /** Applies a pickup, the same call collecting one makes. Lets a driven page
   * reach a state worth looking at — a stocked bag, a running buff timer —
   * without a test-only setter for each of them. */
  grant(kind: PowerUpKind): boolean;
  lives(): number;
  bossesDowned(): number;
  bossHp(): number;
  /** Advances the world by `frames` fixed steps — the seam that makes the
   * simulation observable without waiting for requestAnimationFrame, which
   * headless Chrome barely runs. */
  step(frames?: number, dtMs?: number, input?: InputState): void;
  /** A snapshot of everything the ramp is supposed to move, for checks that
   * assert the run actually gets harder rather than eyeballing a screenshot. */
  probe(): {
    phase: string;
    elapsedMs: number;
    enemies: number;
    bullets: number;
    enemyBullets: number;
    powerUps: number;
    explosions: number;
    energy: number;
    overdriveFraction: number;
    scrollY: number;
    progress: number;
    bossesDowned: number;
    chargers: number;
    boss: {
      archetype: string;
      round: number;
      bars: number;
      barIndex: number;
      enraged: boolean;
      split: boolean;
      telegraphs: number;
    } | null;
  };
}

export function installHarness(): Harness {
  const harness: Harness = {
    state: () => state.phase,
    select: (shipIndex: number) => {
      resetSpawnTimers();
      selectShip(shipIndex);
    },
    hitPlayer: () => hitPlayer(),
    registerKill: () => registerKill(),
    defeatBoss: () => defeatBoss(),
    damageBoss: (amount: number) => {
      if (!state.boss) return;
      state.boss.hp -= amount;
      advanceBossPhase(state.boss);
    },
    grant: (kind: PowerUpKind) => (state.player ? applyPowerUp(state.player, kind) : false),
    lives: () => state.player?.lives ?? 0,
    bossesDowned: () => state.bossesDowned,
    bossHp: () => state.boss?.maxHp ?? 0,
    step: (frames = 1, dtMs = 16, input?: InputState) => {
      // Input goes straight through to the same frame function a held key
      // reaches, so a driven ship can actually fly rather than only sit still.
      for (let i = 0; i < frames; i++) stepWorld(dtMs, input);
    },
    probe: () => ({
      phase: state.phase,
      elapsedMs: state.elapsedMs,
      enemies: state.enemies.length,
      bullets: state.bullets.length,
      enemyBullets: state.bullets.filter((bullet) => bullet.owner === "enemy").length,
      powerUps: state.powerUps.length,
      explosions: state.explosions.length,
      energy: state.player?.energy ?? 0,
      overdriveFraction: (state.player?.overdriveMs ?? 0) / OVERDRIVE_MS,
      scrollY: state.scrollY,
      progress: state.progress,
      bossesDowned: state.bossesDowned,
      chargers: state.enemies.filter((enemy) => enemy.kind === "charger").length,
      boss: state.boss
        ? {
            archetype: state.boss.archetype,
            round: state.boss.round,
            bars: state.boss.bars,
            barIndex: bossBarIndex(state.boss),
            enraged: state.boss.enraged,
            split: state.boss.clone !== null,
            telegraphs: state.boss.telegraphs.length,
          }
        : null,
    }),
  };
  (window as unknown as { harness: Harness }).harness = harness;
  return harness;
}
