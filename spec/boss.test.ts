import { beforeEach, describe, expect, it } from "vitest";
import { stepBulletsAndCollisions } from "../src/collision";
import { installHarness } from "../src/harness";
import { registerKill, resetGame, state } from "../src/state";
import {
  advanceBossPhase,
  ARENA_HEIGHT,
  BOSS_BAR_HP,
  type Boss,
  type Bullet,
  bossBarIndex,
  createBoss,
  type Enemy,
  isEnemyOffscreen,
  ROUNDS_TO_WIN,
  updateBoss,
  updateEnemy,
} from "../src/entities";

// Three rounds, three fights. What is worth pinning here is not that a boss
// exists — the ending test covers the cycle — but the rules the fights are
// built on, because every one of them is invisible to a screenshot: a bar
// boundary, a one-shot enrage, a shared health pool across two bodies, and a
// warning that has to land before the thing it warns about.
//
// All of it drives the same functions main.ts's frame loop drives.

(globalThis as { window?: unknown }).window = globalThis;
const harness = installHarness();

const PLAYER_X = 240;
const PLAYER_Y = 700;
const KILLS_TO_BOSS = 10;

/** A real run advanced to the start of round `round`, so the boss under test
 * is the one `state` is actually holding — not a detached createBoss(). */
function bossAtRound(round: number): Boss {
  resetGame();
  harness.select(0);
  for (let r = 1; r <= round; r++) {
    for (let i = 0; i < KILLS_TO_BOSS; i++) registerKill();
    if (r < round) harness.defeatBoss();
  }
  const boss = state.boss;
  if (!boss) throw new Error(`no boss at round ${round}`);
  return boss;
}

/** One frame, at the fixed step the harness uses. */
function step(boss: Boss, bullets: Bullet[], enemies: Enemy[], dtMs = 16): void {
  updateBoss(boss, dtMs / 1000, dtMs, bullets, enemies, PLAYER_X, PLAYER_Y);
}

function run(boss: Boss, ms: number): { bullets: Bullet[]; enemies: Enemy[] } {
  const bullets: Bullet[] = [];
  const enemies: Enemy[] = [];
  for (let elapsed = 0; elapsed < ms; elapsed += 16) step(boss, bullets, enemies);
  return { bullets, enemies };
}

/** Damages a boss the way collision.ts does — hp down, then let the boss
 * react — and returns every transition it went through. */
function damageTo(boss: Boss, hp: number): Array<string | null> {
  const seen: Array<string | null> = [];
  while (boss.hp > hp) {
    boss.hp -= 1;
    seen.push(advanceBossPhase(boss));
  }
  return seen.filter((t) => t !== null);
}

describe("the three boss rounds", () => {
  it("scale 120 / 240 / 360 across one bar per round", () => {
    const totals = [1, 2, 3].map((round) => createBoss(round));

    expect(totals.map((boss) => boss.maxHp)).toEqual([120, 240, 360]);
    expect(totals.map((boss) => boss.bars)).toEqual([1, 2, 3]);
    // Every bar is the same size, which is what makes "round 2 enrages below
    // half" and "round 3 splits on its last bar" one rule rather than two.
    for (const boss of totals) expect(boss.maxHp / boss.bars).toBe(BOSS_BAR_HP);
    expect(totals.map((boss) => boss.archetype)).toEqual(["summoner", "berserker", "twin"]);
    expect(totals.length).toBe(ROUNDS_TO_WIN);
  });

  it("gives each round a different opening volley", () => {
    const volleys = [1, 2, 3].map((round) => {
      const boss = createBoss(round);
      const bullets: Bullet[] = [];
      step(boss, bullets, []);
      return bullets.length;
    });

    expect(new Set(volleys).size).toBe(volleys.length);
    for (const count of volleys) expect(count).toBeGreaterThan(0);
  });
});

describe("round 2: the berserker", () => {
  it("enrages exactly once, and only on reaching its last bar", () => {
    const boss = createBoss(2);
    expect(boss.enraged).toBe(false);

    // Down to one point above the halfway line: still on the first bar.
    const beforeHalf = damageTo(boss, BOSS_BAR_HP + 1);
    expect(beforeHalf).not.toContain("enrage");
    expect(boss.enraged).toBe(false);
    expect(bossBarIndex(boss)).toBe(2);

    const crossing = damageTo(boss, BOSS_BAR_HP);
    expect(crossing).toContain("enrage");
    expect(boss.enraged).toBe(true);
    expect(bossBarIndex(boss)).toBe(1);

    // Everything after the trigger is just damage.
    expect(damageTo(boss, 1)).not.toContain("enrage");
  });

  it("throws a denser, faster volley once enraged", () => {
    const calm = createBoss(2);
    const calmVolley = run(calm, 3000).bullets.length;

    const angry = createBoss(2);
    angry.hp = BOSS_BAR_HP;
    advanceBossPhase(angry);
    const angryVolley = run(angry, 3000).bullets.length;

    expect(angry.enraged).toBe(true);
    expect(angryVolley).toBeGreaterThan(calmVolley);
  });
});

describe("round 3: the twin", () => {
  it("splits only on its last bar, and both bodies fire", () => {
    const boss = createBoss(3);
    expect(boss.clone).toBeNull();

    expect(damageTo(boss, BOSS_BAR_HP + 1)).not.toContain("clone");
    expect(boss.clone).toBeNull();

    expect(damageTo(boss, BOSS_BAR_HP)).toContain("clone");
    expect(boss.clone).not.toBeNull();

    // Mirrored across the arena, and firing in lockstep: a volley from a split
    // twin is twice the volley of an unsplit one.
    const solo = createBoss(3);
    const soloVolley: Bullet[] = [];
    step(solo, soloVolley, []);

    const pairVolley: Bullet[] = [];
    boss.patternCooldownMs = 0;
    step(boss, pairVolley, []);
    expect(pairVolley.length).toBe(soloVolley.length * 2);
  });

  // Driven through collision.ts rather than by poking hp directly. The sharing
  // isn't a property of the boss object — both bodies read the same field no
  // matter what — it's a property of the hit test, so a test that doesn't fire
  // a bullet through the real collision pass can't fail when sharing breaks.
  it("takes damage on the clone into the same pool, through the real hit test", () => {
    const boss = bossAtRound(3);
    // Off-centre first: the copy is a mirror through the middle of the arena,
    // so a boss sitting dead centre is standing on its own reflection. They
    // pass through each other once a sweep in a real fight; here we need them
    // apart so a bullet can be aimed at one and not the other.
    boss.x = 140;
    boss.hp = BOSS_BAR_HP;
    advanceBossPhase(boss);
    const clone = boss.clone;
    expect(clone).not.toBeNull();
    if (!clone) return;

    expect(Math.abs(clone.x - boss.x)).toBeGreaterThan(80);
    state.bullets = [
      { owner: "player", x: clone.x, y: clone.y, vx: 0, vy: 0, width: 8, height: 8, damage: 5 },
    ];

    const before = boss.hp;
    stepBulletsAndCollisions(0.016, 16);
    expect(boss.hp).toBe(before - 5);
  });
});

describe("round 1: the summoner", () => {
  it("warns before it charges: nothing spawns while a lane is still lit", () => {
    const boss = createBoss(1);
    const bullets: Bullet[] = [];
    const enemies: Enemy[] = [];

    // Run until it marks its first lanes.
    for (let elapsed = 0; elapsed < 3000 && boss.telegraphs.length === 0; elapsed += 16) {
      step(boss, bullets, enemies);
    }
    expect(boss.telegraphs.length).toBeGreaterThan(0);
    const lanes = boss.telegraphs.map((lane) => lane.x);

    // The warning has to be worth something: while any lane is lit, no charger
    // may exist. This is the fairness rule the whole mechanic rests on — a
    // dive with no warning is not a dodge, it is a coin flip.
    let framesWarned = 0;
    while (boss.telegraphs.length > 0) {
      expect(enemies.some((enemy) => enemy.kind === "charger")).toBe(false);
      step(boss, bullets, enemies);
      framesWarned += 1;
    }
    expect(framesWarned * 16).toBeGreaterThan(600);

    const chargers = enemies.filter((enemy) => enemy.kind === "charger");
    expect(chargers.length).toBeGreaterThan(0);
    // And they come down the lanes that were actually lit, not somewhere else.
    for (const charger of chargers) {
      expect(lanes).toContain(charger.x);
    }
  });

  it("retires chargers once they leave the arena", () => {
    const boss = createBoss(1);
    const bullets: Bullet[] = [];
    const enemies: Enemy[] = [];
    for (let elapsed = 0; elapsed < 6000; elapsed += 16) step(boss, bullets, enemies);
    const dive = enemies.find((enemy) => enemy.kind === "charger");
    expect(dive).toBeDefined();
    if (!dive) return;

    expect(isEnemyOffscreen(dive)).toBe(false);
    for (let elapsed = 0; elapsed < 6000; elapsed += 16) updateEnemy(dive, 0.016, 16, [], PLAYER_X, 1);
    expect(dive.y).toBeGreaterThan(ARENA_HEIGHT);
    expect(isEnemyOffscreen(dive)).toBe(true);
  });
});

describe("bar breaks", () => {
  beforeEach(() => {
    // nothing shared; the bosses here are built per test
  });

  it("fire once per boundary and flash the boss", () => {
    const boss = createBoss(3);
    const first = damageTo(boss, BOSS_BAR_HP * 2);
    expect(first.length).toBe(1);
    expect(boss.flashMs).toBeGreaterThan(0);
    expect(bossBarIndex(boss)).toBe(2);

    const second = damageTo(boss, BOSS_BAR_HP);
    expect(second).toEqual(["clone"]);
    expect(bossBarIndex(boss)).toBe(1);
  });

  it("never fire for a single-bar boss", () => {
    const boss = createBoss(1);
    expect(damageTo(boss, 1)).toEqual([]);
  });
});
