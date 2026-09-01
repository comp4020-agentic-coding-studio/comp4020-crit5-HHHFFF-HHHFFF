import { beforeEach, describe, expect, it } from "vitest";
import { stepBulletsAndCollisions } from "../src/collision";
import { installHarness } from "../src/harness";
import { BOSS_INTRO_MS, registerKill, resetGame, ROUND_MIN_MS, state } from "../src/state";
import {
  advanceBossPhase,
  applyPowerUp,
  ARENA_HEIGHT,
  BOSS_BAR_HP,
  type Boss,
  type Bullet,
  bossBarIndex,
  bossPatterns,
  createBoss,
  createEliteWing,
  createPlayer,
  type Enemy,
  FORMATION_ARRIVAL_T,
  formationSize,
  isEnemyOffscreen,
  randomPowerUpKind,
  ROUNDS_TO_WIN,
  updateBoss,
  updateEnemy,
  wingEntryColumns,
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
    // A boss needs the round clock as well as the meter, so serve the wait by
    // stepping real frames — lives topped up, since the point is the boss, not
    // whether an idle ship survives fifty seconds.
    if (state.player) state.player.lives = 100_000;
    const frames = Math.ceil(ROUND_MIN_MS / 16) + 2;
    for (let i = 0; i < frames && state.phase === "playing"; i++) harness.step(1, 16);
    let guard = 0;
    while (state.phase === "playing" && guard++ < 200) registerKill();
    if (r < round) harness.defeatBoss();
  }
  // Fly out the arrival cutaway: the boss is inert and untouchable during it,
  // so a test that skipped it would be shooting at nothing.
  for (let i = 0; i < Math.ceil(BOSS_INTRO_MS / 16) + 2; i++) harness.step(1, 16);
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

  // Each round keeps the last round's whole repertoire and adds one to it, so
  // the earlier list is always a prefix of the later one. Opening volleys are
  // deliberately the *same* shape now — round 2 inherits round 1's aimed fan
  // and opens with it — so what distinguishes the rounds is how many shapes
  // they cycle through, not the first one you see.
  it("inherits every earlier round's attacks and adds one", () => {
    expect(bossPatterns(1)).toEqual(["aimed"]);
    expect(bossPatterns(2)).toEqual(["aimed", "spiral"]);
    expect(bossPatterns(3)).toEqual(["aimed", "spiral", "pulse"]);

    for (const round of [2, 3]) {
      expect(bossPatterns(round).slice(0, round - 1)).toEqual(bossPatterns(round - 1));
    }
  });

  it("cycles more distinct volleys the later the round", () => {
    const distinctVolleys = (round: number): number => {
      const boss = createBoss(round);
      const sizes = new Set<number>();
      for (let i = 0; i < 6; i++) {
        const bullets: Bullet[] = [];
        boss.patternCooldownMs = 0;
        step(boss, bullets, []);
        expect(bullets.length).toBeGreaterThan(0);
        sizes.add(bullets.length);
      }
      return sizes.size;
    };

    expect(distinctVolleys(1)).toBe(1);
    expect(distinctVolleys(3)).toBeGreaterThan(distinctVolleys(1));
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
    // twin is exactly twice the volley of the same boss unsplit. Compared
    // against itself with the clone taken away rather than against a fresh
    // round-3 boss, because by now this one is also enraged and one volley
    // into its cycle — a fresh one would differ for reasons that have nothing
    // to do with the split.
    const pairVolley: Bullet[] = [];
    boss.patternCooldownMs = 0;
    step(boss, pairVolley, []);

    const soloVolley: Bullet[] = [];
    boss.clone = null;
    boss.volley -= 1; // repeat the same pattern in the cycle
    boss.patternCooldownMs = 0;
    step(boss, soloVolley, []);

    expect(soloVolley.length).toBeGreaterThan(0);
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

// The approach to a boss is a section of the run in its own right now, not a
// countdown you outrun by killing fast.
describe("the approach to a boss", () => {
  it("holds the boss back until the round clock is served, meter or not", () => {
    resetGame();
    harness.select(0);
    if (state.player) state.player.lives = 100_000;

    // Meter full immediately: without the clock gate this alone used to summon
    // a boss about twenty seconds in.
    for (let i = 0; i < 40; i++) registerKill();
    expect(harness.state()).toBe("playing");

    // And it stays held right up to the line.
    const justShort = Math.floor((ROUND_MIN_MS - 1000) / 16);
    for (let i = 0; i < justShort; i++) harness.step(1, 16);
    expect(harness.state()).toBe("playing");

    for (let i = 0; i < 100; i++) harness.step(1, 16);
    expect(harness.state()).toBe("boss");
  });

  it("shows whichever requirement is further off, so the meter can't sit full", () => {
    resetGame();
    harness.select(0);
    if (state.player) state.player.lives = 100_000;
    for (let i = 0; i < 40; i++) registerKill();

    // Kills are done; the clock isn't, so the bar has to read the clock.
    harness.step(Math.floor(ROUND_MIN_MS / 2 / 16), 16);
    expect(state.progress).toBeGreaterThan(0.3);
    expect(state.progress).toBeLessThan(0.8);
  });

  it("sends elite wings in formation, from more than one edge", () => {
    const shapes = new Set<string>();
    const entries = new Set<string>();

    // Sampled as the round runs, not at the end of it: a boss phase clears the
    // arena, so a single look after ROUND_MIN_MS finds nothing at all.
    for (let attempt = 0; attempt < 12; attempt++) {
      resetGame();
      harness.select(0);
      if (state.player) state.player.lives = 100_000;
      const frames = Math.floor(ROUND_MIN_MS / 16);
      for (let i = 0; i < frames && state.phase === "playing"; i++) {
        harness.step(1, 16);
        for (const enemy of state.enemies) {
          if (enemy.kind !== "elite") continue;
          if (enemy.formShape) shapes.add(enemy.formShape);
          if (enemy.formEntry) entries.add(enemy.formEntry);
        }
      }
    }
    expect(shapes.size).toBeGreaterThan(0);

    // Squads used to arc up from the bottom and only from the bottom.
    expect(shapes.size).toBeGreaterThan(1);
    expect(entries.size).toBeGreaterThan(1);
  });

  it("holds a wing's shape while it flies", () => {
    const wing = createEliteWing("ring", "top", 1);
    expect(wing.length).toBe(formationSize("ring"));

    // Fly it to the middle of its hold, where the shape is supposed to be a
    // shape rather than a line of ships still arriving.
    for (let i = 0; i < 320; i++) {
      for (const elite of wing) updateEnemy(elite, 0.016, 16, [], PLAYER_X, 1);
    }

    const cx = wing.reduce((sum, e) => sum + e.x, 0) / wing.length;
    const cy = wing.reduce((sum, e) => sum + e.y, 0) / wing.length;
    const radii = wing.map((e) => Math.hypot(e.x - cx, e.y - cy));
    // Every member the same distance from the centre is what "ring" means.
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(12);
    for (const elite of wing) expect(elite.y).toBeGreaterThan(0);
  });

  // A wing is several ships abreast, so one beam down the middle of the
  // formation announces a column most of them never use. Every shape gets
  // checked because they spread differently: a column is one lane, a line is
  // six, and a ring's members are still moving when they arrive.
  it("marks one column per ship, where that ship actually comes up", () => {
    for (const shape of ["ring", "line", "wedge", "column"] as const) {
      const wing = createEliteWing(shape, "bottom", 1);
      const lanes = wingEntryColumns(wing);
      expect(lanes.length).toBeGreaterThan(0);

      // Fly it to the moment it finishes arriving --- the instant the beams
      // are promising something about.
      while ((wing[0].formT ?? 0) < FORMATION_ARRIVAL_T) {
        for (const elite of wing) updateEnemy(elite, 0.016, 16, [], PLAYER_X, 1);
      }

      for (const elite of wing) {
        const nearest = Math.min(...lanes.map((lane) => Math.abs(lane - elite.x)));
        expect(nearest).toBeLessThan(20);
      }
      // A column formation stacks vertically, so it must not be announced with
      // one beam per ship.
      if (shape === "column") expect(lanes.length).toBe(1);
      if (shape === "line") expect(lanes.length).toBe(formationSize("line"));
    }
  });

  it("retires a wing once it has flown through", () => {
    const wing = createEliteWing("line", "left", 1);
    expect(wing.every((elite) => !isEnemyOffscreen(elite))).toBe(true);
    for (let i = 0; i < 900; i++) {
      for (const elite of wing) updateEnemy(elite, 0.016, 16, [], PLAYER_X, 1);
    }
    expect(wing.every((elite) => isEnemyOffscreen(elite))).toBe(true);
  });
});

describe("the boss's arrival", () => {
  /** Runs a round up to the moment the boss lands. */
  function atArrival(): void {
    resetGame();
    harness.select(0);
    if (state.player) state.player.lives = 100_000;
    const frames = Math.ceil(ROUND_MIN_MS / 16) + 2;
    for (let i = 0; i < frames && state.phase === "playing"; i++) harness.step(1, 16);
    let guard = 0;
    while (state.phase === "playing" && guard++ < 200) registerKill();
  }

  it("freezes the fight for the cutaway, then starts it", () => {
    atArrival();
    expect(state.phase).toBe("boss");
    // Not exactly BOSS_INTRO_MS: the frame that starts the boss also ticks it
    // down once before it returns.
    expect(state.introMs).toBeGreaterThan(BOSS_INTRO_MS - 100);
    expect(state.introMs).toBeLessThanOrEqual(BOSS_INTRO_MS);

    const boss = state.boss;
    expect(boss).not.toBeNull();
    if (!boss) return;
    const startedAt = { x: boss.x, hp: boss.hp };

    // Through the cutaway: the boss doesn't move, doesn't fire, and — the part
    // that would otherwise let a player delete a bar behind the curtain —
    // doesn't take damage either.
    for (let i = 0; i < Math.ceil(BOSS_INTRO_MS / 16) - 4; i++) {
      state.bullets.push({
        owner: "player",
        x: boss.x,
        y: boss.y,
        vx: 0,
        vy: 0,
        width: 8,
        height: 8,
        damage: 5,
      });
      harness.step(1, 16);
    }
    expect(state.introMs).toBeGreaterThan(0);
    expect(boss.x).toBe(startedAt.x);
    expect(boss.hp).toBe(startedAt.hp);
    expect(state.bullets.some((bullet) => bullet.owner === "enemy")).toBe(false);

    // And once it is over, the fight is a fight.
    for (let i = 0; i < 200; i++) harness.step(1, 16);
    expect(state.introMs).toBe(0);
    expect(boss.x).not.toBe(startedAt.x);
  });
});

describe("wings that come up from behind", () => {
  it("announce the column before rising through it", () => {
    // Bottom entries are the only arrival that starts behind the player, so
    // they are the only one that gets a warning. Driven straight at the
    // spawner rather than waiting for a random bottom entry to come up.
    // Entry edges are picked at random, so a bottom entry may not come up
    // inside any one round. Retried across rounds rather than waited for in
    // one, which would make the check a coin flip — the exact failure this
    // suite already learned about once.
    let sawWarningFirst = false;

    for (let attempt = 0; attempt < 12 && !sawWarningFirst; attempt++) {
      resetGame();
      harness.select(0);
      if (state.player) state.player.lives = 100_000;

      let guard = 0;
      while (!sawWarningFirst && guard++ < 4000 && state.phase === "playing") {
        harness.step(1, 16);
        if (!state.telegraphs.some((lane) => lane.rising)) continue;

        // Everything already on screen when the beam lights. Anything that
        // rises from the bottom *after* this point, before the beam clears,
        // is an arrival that outran its own warning.
        const lanes = state.telegraphs.filter((lane) => lane.rising).map((lane) => lane.x);
        const before = new Set(state.enemies);
        let framesWarned = 0;
        while (state.telegraphs.some((lane) => lane.rising) && state.phase === "playing") {
          for (const enemy of state.enemies) {
            if (enemy.kind !== "elite" || enemy.formEntry !== "bottom") continue;
            expect(before.has(enemy)).toBe(true);
          }
          harness.step(1, 16);
          framesWarned += 1;
        }
        expect(framesWarned * 16).toBeGreaterThan(600);

        const arrived = state.enemies.filter(
          (enemy) => enemy.kind === "elite" && enemy.formEntry === "bottom" && !before.has(enemy),
        );
        expect(arrived.length).toBeGreaterThan(0);

        // The warning has to be about *this* wing. The first version built a
        // wing to read its column, threw it away, and called createEliteWing
        // again on arrival — which re-rolls the hold, so the beams marked one
        // column and the ships came up somewhere else entirely.
        const arrivedColumns = wingEntryColumns(arrived);
        expect(arrivedColumns.length).toBe(lanes.length);
        for (const column of arrivedColumns) {
          expect(lanes.some((lane) => Math.abs(lane - column) < 1)).toBe(true);
        }
        sawWarningFirst = true;
      }
    }

    expect(sawWarningFirst).toBe(true);
  });
});

describe("the repair pickup", () => {
  it("gives a life back, but never more than the ship carries", () => {
    const player = createPlayer(0);
    player.lives = 1;

    expect(applyPowerUp(player, "repair")).toBe(true);
    expect(player.lives).toBe(2);
    while (player.lives < player.maxLives) expect(applyPowerUp(player, "repair")).toBe(true);

    // At full lives it does nothing and says so, which is what stops the
    // pickup sound firing on a pickup that did nothing.
    expect(applyPowerUp(player, "repair")).toBe(false);
    expect(player.lives).toBe(player.maxLives);
  });

  it("is only ever offered to a player who has lost one", () => {
    const healthy = new Set<string>();
    for (let i = 0; i < 300; i++) healthy.add(randomPowerUpKind(0));
    expect(healthy.has("repair")).toBe(false);

    const hurt = new Set<string>();
    for (let i = 0; i < 300; i++) hurt.add(randomPowerUpKind(2));
    expect(hurt.has("repair")).toBe(true);
  });

  it("stops widening the gun once it is wide enough", () => {
    const player = createPlayer(0);
    let applied = 0;
    for (let i = 0; i < 20; i++) if (applyPowerUp(player, "multiply")) applied += 1;

    // Doubling here is what let a long run reach multiplier 64 and delete the
    // bosses; the cap is the fix, and this is the check that keeps it.
    expect(player.weapon.multiplier).toBeLessThanOrEqual(6);
    expect(applied).toBeLessThan(20);
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
