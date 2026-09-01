// Entity types and their per-frame update logic. Nothing here touches game
// state directly — every function takes the arrays/objects it operates on as
// arguments, so this module has no notion of phases, progress or win/loss.
// That split is what let spec/ending.test.ts be written before any of this
// existed: state.ts and harness.ts didn't need any of it to compile.

export const ARENA_WIDTH = 480;
export const ARENA_HEIGHT = 800;
export const UPPER_HALF = ARENA_HEIGHT * 0.55;

// The endless ramp. Difficulty is 1.0 at launch and climbs by 1 every
// RAMP_MS with no ceiling: spawn rates, enemy speed, fire intervals, arc
// speed and the backdrop scroll all read it, so the run tightens on its own
// and the only way out is death. Deriving it from elapsed time rather than
// storing a level means there's no counter to get out of sync — and it stays
// a pure function, so it's testable without a running game.
export const RAMP_MS = 40000;

export function difficultyAt(elapsedMs: number): number {
  return 1 + elapsedMs / RAMP_MS;
}

/** Backdrop scroll at difficulty 1, px/s. Scales with difficulty so the sense
 * of speed tracks the actual pressure. */
export const BACKGROUND_SPEED = 70;

export type ShipKey = "interceptor" | "bulwark" | "striker";

export interface ShipDef {
  key: ShipKey;
  name: string;
  color: string;
  speed: number; // px/s
  fireIntervalMs: number;
  bulletSpeed: number; // px/s
  blurb: string;
}

export const SHIPS: ShipDef[] = [
  {
    key: "interceptor",
    name: "Interceptor",
    color: "#ff5c5c",
    speed: 260,
    fireIntervalMs: 180,
    bulletSpeed: 480,
    blurb: "Fast, fragile, average fire rate.",
  },
  {
    key: "bulwark",
    name: "Bulwark",
    color: "#ffb84f",
    speed: 170,
    fireIntervalMs: 220,
    bulletSpeed: 480,
    blurb: "Slow, tankier feel, wider bullets.",
  },
  {
    key: "striker",
    name: "Striker",
    color: "#ff5f7e",
    speed: 220,
    fireIntervalMs: 120,
    bulletSpeed: 520,
    blurb: "Balanced speed, rapid fire.",
  },
];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface ShipStat {
  label: string;
  value: string;
  fill: number; // 0..1, how far the bar runs
}

/** The numbers behind the select screen's bars. The ranges are deliberately
 * wider than the three ships actually span, so no ship reads as empty or as
 * maxed out — a bar pinned to either end looks like a bug, not a stat. */
export function shipStats(ship: ShipDef): ShipStat[] {
  const shotsPerSecond = 1000 / ship.fireIntervalMs;
  return [
    { label: "Thrust", value: String(ship.speed), fill: clamp01((ship.speed - 120) / 180) },
    { label: "Cadence", value: `${shotsPerSecond.toFixed(1)}/s`, fill: clamp01((shotsPerSecond - 2.5) / 7) },
    { label: "Muzzle", value: String(ship.bulletSpeed), fill: clamp01((ship.bulletSpeed - 420) / 140) },
  ];
}

export interface WeaponState {
  diagonals: boolean;
  laser: boolean;
  multiplier: number;
}

// The energy meter. It fills on its own so it always eventually pays out, and
// kills fill it faster so aggression is rewarded; topping out spends the whole
// bar on OVERDRIVE_MS of laser. There is nothing to press — same reasoning as
// auto-fire, and the same reason the spec's no-instructions rule isn't a
// problem here: a bar that fills and then visibly does something teaches
// itself.
export const OVERDRIVE_MS = 10000;
const ENERGY_FILL_MS = 46000;
const ENERGY_PER_KILL = 0.045;

export interface Player {
  x: number;
  y: number;
  ship: ShipDef;
  lives: number;
  maxLives: number;
  weapon: WeaponState;
  fireCooldownMs: number;
  invulnerableMs: number;
  energy: number; // 0..1
  overdriveMs: number; // > 0 while the free laser is running
}

// "charger" is the summoner's: it ignores the patrol band entirely and dives
// the full height of the arena down one lane, after that lane has been
// telegraphed. "elite" flies in formation — see FORMATIONS below.
export type EnemyKind = "normal" | "event" | "charger" | "elite";

/** The shapes an elite wing flies in. Each one is only a set of offsets from a
 * moving anchor, so a wing holds its shape wherever the anchor goes and the
 * difference between them is four lines of trigonometry, not four movement
 * systems. */
export type FormationShape = "ring" | "line" | "wedge" | "column";

/** Which edge a wing enters from. Squads used to arrive from the bottom and
 * only from the bottom, which made every wave the same event twice. */
export type FormationEntry = "top" | "left" | "right" | "bottom";

export interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number; // px/s magnitude the eight-way wander moves at
  hp: number;
  fireCooldownMs: number;
  fireIntervalMs: number;
  dirChangeMs: number;
  // event-only arc path
  arcT?: number;
  arcDuration?: number;
  arcStartX?: number;
  arcAmplitude?: number;
  // elite-only formation flight
  formShape?: FormationShape;
  formIndex?: number;
  formSize?: number;
  formT?: number; // 0..1 along the anchor's in-hold-out path
  formDuration?: number;
  formEntry?: FormationEntry;
  formHoldX?: number;
  formHoldY?: number;
}

// Three rounds, three different fights. The archetype is what makes a round
// its own encounter rather than the same boss with a bigger number: each one
// fires on its own logic and carries one signature mechanic.
export type BossArchetype = "summoner" | "berserker" | "twin";

/** A path something is about to travel, drawn before it travels it. The
 * warning is the mechanic --- an arrival out of nowhere is unfair, the same
 * arrival announced a second early is a dodge you either make or don't.
 *
 * Used by two owners: the boss marks lanes it is about to send chargers down,
 * and step.ts marks the column an elite wing is about to rise through when it
 * enters from the bottom. Bottom entries are the ones that come up behind the
 * player, which is exactly the arrival that needs announcing. `rising` only
 * changes which end of the beam is bright. */
export interface Telegraph {
  x: number;
  msLeft: number;
  totalMs: number;
  rising: boolean;
}

export interface Boss {
  x: number;
  y: number;
  vx: number;
  hp: number; // the whole boss, not the current bar
  maxHp: number;
  patternCooldownMs: number;
  round: number; // 1-based
  archetype: BossArchetype;
  /** Health bars. Damage runs through them one at a time; `barIndex` is which
   * one is draining, counting down, so 1 is always the last. */
  bars: number;
  barIndex: number;
  volley: number; // volleys fired, which is what rotates the spiral
  enraged: boolean;
  enrageMs: number; // > 0 while the enrage flare plays
  flashMs: number; // > 0 just after a bar breaks
  telegraphs: Telegraph[];
  summonMs: number;
  /** The twin's copy of itself, mirrored across the arena and firing in
   * lockstep. Shares `hp`: shooting either body drains the same bar, so
   * picking the "wrong" target never wastes a magazine. */
  clone: { x: number; y: number } | null;
}

export type BulletOwner = "player" | "enemy";

export interface Bullet {
  owner: BulletOwner;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  damage: number;
}

export type PowerUpKind = "laser" | "diagonal" | "multiply" | "repair";

export interface PowerUp {
  kind: PowerUpKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Six, not three. A run is three full boss rounds with a fifty-second
 * approach each, so a life is a much larger fraction of an hour's practice
 * than it was when a round was twenty seconds — and losing the run to one
 * mistimed dodge in round 3 costs the player everything the brief wants them
 * to reach: the ending. */
export const STARTING_LIVES = 6;

export function createPlayer(shipIndex: number): Player {
  const ship = SHIPS[shipIndex] ?? SHIPS[0];
  return {
    x: ARENA_WIDTH / 2,
    y: ARENA_HEIGHT - 90,
    ship,
    lives: STARTING_LIVES,
    maxLives: STARTING_LIVES,
    weapon: { diagonals: false, laser: false, multiplier: 1 },
    fireCooldownMs: 0,
    invulnerableMs: 0,
    energy: 0,
    overdriveMs: 0,
  };
}

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export function updatePlayerMovement(player: Player, input: InputState, dtSeconds: number): void {
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const len = Math.hypot(dx, dy) || 1;
  player.x += (dx / len) * player.ship.speed * dtSeconds;
  player.y += (dy / len) * player.ship.speed * dtSeconds;
  const margin = 20;
  player.x = Math.min(ARENA_WIDTH - margin, Math.max(margin, player.x));
  player.y = Math.min(ARENA_HEIGHT - margin, Math.max(margin, player.y));
  if (player.invulnerableMs > 0) player.invulnerableMs = Math.max(0, player.invulnerableMs - dtSeconds * 1000);
}

/** Fills the meter and cashes it in. Kept separate from firing so the meter
 * keeps moving even on frames the guns are on cooldown. */
export function updatePlayerEnergy(player: Player, dtMs: number): void {
  if (player.overdriveMs > 0) {
    player.overdriveMs = Math.max(0, player.overdriveMs - dtMs);
    if (player.overdriveMs === 0) player.energy = 0;
    return;
  }
  player.energy = Math.min(1, player.energy + dtMs / ENERGY_FILL_MS);
  if (player.energy >= 1) player.overdriveMs = OVERDRIVE_MS;
}

/** A kill's contribution to the meter. Overdrive banks nothing — the bar is
 * already spent, and letting kills top it back up would chain overdrives
 * forever. */
export function addKillEnergy(player: Player): void {
  if (player.overdriveMs > 0) return;
  player.energy = Math.min(1, player.energy + ENERGY_PER_KILL);
}

/** Auto-fire: nothing for the player to discover, per the no-tutorial spec line. */
export function updatePlayerFiring(player: Player, dtMs: number, bullets: Bullet[]): void {
  const overdrive = player.overdriveMs > 0;
  const laser = overdrive || player.weapon.laser;

  player.fireCooldownMs -= dtMs;
  if (player.fireCooldownMs > 0) return;
  player.fireCooldownMs = player.ship.fireIntervalMs * (overdrive ? 0.5 : 1);

  const lanes: number[] = [0];
  if (player.weapon.diagonals) lanes.push(-45, 45);

  for (const angleDeg of lanes) {
    const angle = (angleDeg * Math.PI) / 180;
    const vx = Math.sin(angle) * player.ship.bulletSpeed;
    const vy = -Math.cos(angle) * player.ship.bulletSpeed;
    for (let n = 0; n < player.weapon.multiplier; n++) {
      const offset = (n - (player.weapon.multiplier - 1) / 2) * 10;
      bullets.push({
        owner: "player",
        x: player.x + offset,
        y: player.y - 20,
        vx,
        vy,
        width: laser ? 10 : 4,
        height: laser ? 28 : 12,
        damage: laser ? 2 : 1,
      });
    }
  }
}

// The eight directions a patrolling enemy picks between, and the band it
// patrols. Enemies stay in the upper half — the brief's rule — but they no
// longer just slide left and right along one line.
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

const PATROL_TOP = 50;
const PATROL_MARGIN = 30;

function retarget(enemy: Enemy): void {
  const [dx, dy] = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
  // Diagonals get the 1/sqrt(2) factor or they'd travel ~41% faster than the
  // four straight headings and the wander would read as biased.
  const diagonal = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
  enemy.vx = dx * diagonal * enemy.speed;
  enemy.vy = dy * diagonal * enemy.speed;
  enemy.dirChangeMs = 450 + Math.random() * 850;
}

export function createNormalEnemy(difficulty: number): Enemy {
  const enemy: Enemy = {
    kind: "normal",
    x: PATROL_MARGIN + Math.random() * (ARENA_WIDTH - PATROL_MARGIN * 2),
    // Spawns above the arena and flies down into the band, rather than
    // popping into existence mid-screen.
    y: -30 - Math.random() * 50,
    vx: 0,
    vy: 0,
    speed: (55 + Math.random() * 45) * Math.min(2.2, difficulty),
    hp: 2,
    fireCooldownMs: (700 + Math.random() * 1200) / difficulty,
    // Both the base and the ceiling on the difficulty divisor were raised with
    // the spray thresholds above: a patroller now fires a little slower and
    // stops getting faster sooner.
    fireIntervalMs: (2100 + Math.random() * 1900) / Math.min(2.2, difficulty),
    dirChangeMs: 0,
  };
  retarget(enemy);
  return enemy;
}

// ---------- elite wings ----------

const FORMATION_SHAPES: FormationShape[] = ["ring", "line", "wedge", "column"];
const FORMATION_ENTRIES: FormationEntry[] = ["top", "left", "right", "bottom"];
const RING_RADIUS = 62;
const RING_SPIN = 0.55; // radians/sec
/** Fractions of the flight spent arriving and leaving; the middle is the hold,
 * which is the part that reads as a formation rather than a fly-past. */
const FORM_IN = 0.3;
const FORM_OUT = 0.72;

export function formationSize(shape: FormationShape): number {
  if (shape === "ring") return 7;
  if (shape === "line") return 6;
  if (shape === "wedge") return 5;
  return 4;
}

export function randomFormation(): { shape: FormationShape; entry: FormationEntry } {
  return {
    shape: FORMATION_SHAPES[Math.floor(Math.random() * FORMATION_SHAPES.length)],
    entry: FORMATION_ENTRIES[Math.floor(Math.random() * FORMATION_ENTRIES.length)],
  };
}

/** Where a wing's anchor starts, holds and finishes, in arena coordinates. The
 * hold is always inside the player's half-free zone up top; a wing that parked
 * on the player would be a collision, not a formation. */
function anchorPath(entry: FormationEntry, holdX: number, holdY: number): {
  from: [number, number];
  hold: [number, number];
  to: [number, number];
} {
  const off = 140;
  if (entry === "top") return { from: [holdX, -off], hold: [holdX, holdY], to: [holdX, -off] };
  if (entry === "bottom") {
    return { from: [holdX, ARENA_HEIGHT + off], hold: [holdX, holdY], to: [holdX, -off] };
  }
  const fromLeft = entry === "left";
  return {
    from: [fromLeft ? -off : ARENA_WIDTH + off, holdY],
    hold: [holdX, holdY],
    to: [fromLeft ? ARENA_WIDTH + off : -off, holdY],
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The anchor's position at `t`, easing in, holding, then easing out. */
function anchorAt(enemy: Enemy, t: number): [number, number] {
  const path = anchorPath(enemy.formEntry ?? "top", enemy.formHoldX ?? ARENA_WIDTH / 2, enemy.formHoldY ?? 200);
  if (t <= FORM_IN) {
    const k = t / FORM_IN;
    const eased = 1 - (1 - k) * (1 - k); // ease-out, so it settles rather than slams
    return [lerp(path.from[0], path.hold[0], eased), lerp(path.from[1], path.hold[1], eased)];
  }
  if (t < FORM_OUT) return [path.hold[0], path.hold[1]];
  const k = (t - FORM_OUT) / (1 - FORM_OUT);
  return [lerp(path.hold[0], path.to[0], k * k), lerp(path.hold[1], path.to[1], k * k)];
}

/** One member's offset from the anchor. This is the whole difference between
 * the shapes. */
function formationOffset(enemy: Enemy, elapsedSeconds: number): [number, number] {
  const index = enemy.formIndex ?? 0;
  const size = enemy.formSize ?? 1;
  const middle = (size - 1) / 2;

  if (enemy.formShape === "ring") {
    const angle = (index / size) * Math.PI * 2 + elapsedSeconds * RING_SPIN;
    return [Math.cos(angle) * RING_RADIUS, Math.sin(angle) * RING_RADIUS];
  }
  if (enemy.formShape === "line") return [(index - middle) * 52, 0];
  if (enemy.formShape === "wedge") return [(index - middle) * 44, Math.abs(index - middle) * 30];
  return [0, (index - middle) * 48]; // column
}

/** How far through a wing's flight it has finished arriving. */
export const FORMATION_ARRIVAL_T = FORM_IN;

/** The columns a wing will actually rise through, one per ship.
 *
 * A wing is several ships abreast, so a single beam down the formation's
 * centre says almost nothing about where any individual ship comes up --- a
 * six-wide line would be announced by one lane and arrive across six. This
 * returns each member's column at the moment it finishes arriving, near-
 * duplicates merged, so a column formation still gets one beam and a line gets
 * six. */
export function wingEntryColumns(wing: Enemy[]): number[] {
  const columns: number[] = [];
  for (const enemy of wing) {
    const duration = enemy.formDuration ?? 9;
    const [offsetX] = formationOffset(enemy, FORM_IN * duration);
    const x = (enemy.formHoldX ?? ARENA_WIDTH / 2) + offsetX;
    if (!columns.some((existing) => Math.abs(existing - x) < 14)) columns.push(x);
  }
  return columns;
}

export function createEliteWing(shape: FormationShape, entry: FormationEntry, difficulty: number): Enemy[] {
  const size = formationSize(shape);
  const margin = 110;
  const holdX = margin + Math.random() * (ARENA_WIDTH - margin * 2);
  const holdY = 150 + Math.random() * 130;
  const duration = 9 / Math.min(1.8, difficulty);

  const wing: Enemy[] = [];
  for (let index = 0; index < size; index++) {
    wing.push({
      kind: "elite",
      x: holdX,
      y: -200,
      vx: 0,
      vy: 0,
      speed: 0,
      hp: 3,
      // Staggered so a wing doesn't fire as one shotgun blast.
      fireCooldownMs: 900 + index * 260 + Math.random() * 500,
      fireIntervalMs: (2200 + Math.random() * 900) / Math.min(2.4, difficulty),
      dirChangeMs: Number.POSITIVE_INFINITY,
      formShape: shape,
      formIndex: index,
      formSize: size,
      formT: 0,
      formDuration: duration,
      formEntry: entry,
      formHoldX: holdX,
      formHoldY: holdY,
    });
  }
  return wing;
}

export function createEventSquadMember(index: number, startX: number, difficulty: number): Enemy {
  return {
    kind: "event",
    x: startX,
    y: ARENA_HEIGHT + 20,
    vx: 0,
    vy: 0,
    speed: 0,
    hp: 1,
    fireCooldownMs: Number.POSITIVE_INFINITY,
    fireIntervalMs: Number.POSITIVE_INFINITY,
    dirChangeMs: Number.POSITIVE_INFINITY,
    arcT: -index * 0.12,
    arcDuration: 4.5 / Math.min(1.9, difficulty),
    arcStartX: startX,
    arcAmplitude: 90 * (startX < ARENA_WIDTH / 2 ? 1 : -1),
  };
}

export function updateEnemy(
  enemy: Enemy,
  dtSeconds: number,
  dtMs: number,
  bullets: Bullet[],
  playerX: number,
  difficulty: number,
): void {
  if (enemy.kind === "normal") {
    if (enemy.y < PATROL_TOP) {
      // Flying in from above: no wander, no clamp, until it reaches the band.
      enemy.y += enemy.speed * dtSeconds;
      if (enemy.y >= PATROL_TOP) retarget(enemy);
    } else {
      enemy.dirChangeMs -= dtMs;
      if (enemy.dirChangeMs <= 0) retarget(enemy);
      enemy.x += enemy.vx * dtSeconds;
      enemy.y += enemy.vy * dtSeconds;

      // Turn away from the walls rather than sliding along them, and cut the
      // timer short so a cornered enemy re-picks soon instead of grinding.
      if (enemy.x < PATROL_MARGIN) {
        enemy.x = PATROL_MARGIN;
        enemy.vx = Math.abs(enemy.vx);
        enemy.dirChangeMs = Math.min(enemy.dirChangeMs, 250);
      } else if (enemy.x > ARENA_WIDTH - PATROL_MARGIN) {
        enemy.x = ARENA_WIDTH - PATROL_MARGIN;
        enemy.vx = -Math.abs(enemy.vx);
        enemy.dirChangeMs = Math.min(enemy.dirChangeMs, 250);
      }
      if (enemy.y < PATROL_TOP) {
        enemy.y = PATROL_TOP;
        enemy.vy = Math.abs(enemy.vy);
      } else if (enemy.y > UPPER_HALF) {
        enemy.y = UPPER_HALF;
        enemy.vy = -Math.abs(enemy.vy);
      }
    }

    enemy.fireCooldownMs -= dtMs;
    if (enemy.fireCooldownMs <= 0) {
      enemy.fireCooldownMs = enemy.fireIntervalMs;
      const vy = 180 * Math.min(2, difficulty);
      const vx = ((playerX - enemy.x) / ARENA_HEIGHT) * vy;
      // Density climbs in steps as well as in rate: late runs get sprays, not
      // just faster singles. The thresholds moved out (2/3 -> 2.5/4) once
      // elite wings started firing alongside the patrollers and a run got long
      // enough to reach difficulty 6: three sprays per patroller plus a wing
      // plus a boss was a screen with no gaps in it, which isn't difficulty.
      const shots = difficulty >= 4 ? 3 : difficulty >= 2.5 ? 2 : 1;
      for (let i = 0; i < shots; i++) {
        const spread = (i - (shots - 1) / 2) * 34;
        bullets.push({
          owner: "enemy",
          x: enemy.x,
          y: enemy.y + 16,
          vx: vx + spread,
          vy,
          width: 6,
          height: 12,
          damage: 1,
        });
      }
    }
    return;
  }

  if (enemy.kind === "charger") {
    // Straight down the telegraphed lane, no wander and no firing: the threat
    // is the body, and the lane was shown a beat before it arrived.
    enemy.y += enemy.vy * dtSeconds;
    return;
  }

  if (enemy.kind === "elite") {
    const duration = enemy.formDuration ?? 9;
    enemy.formT = (enemy.formT ?? 0) + dtSeconds / duration;
    const t = Math.max(0, Math.min(1, enemy.formT));
    const [ax, ay] = anchorAt(enemy, t);
    const [ox, oy] = formationOffset(enemy, t * duration);
    enemy.x = ax + ox;
    enemy.y = ay + oy;

    // Only fires once it has arrived: a wing shooting from off-screen is an
    // ambush, and the shape is supposed to be the warning.
    if (t < FORM_IN) return;
    enemy.fireCooldownMs -= dtMs;
    if (enemy.fireCooldownMs > 0) return;
    enemy.fireCooldownMs = enemy.fireIntervalMs;
    const vy = 200 * Math.min(2, difficulty);
    const vx = ((playerX - enemy.x) / ARENA_HEIGHT) * vy;
    bullets.push({ owner: "enemy", x: enemy.x, y: enemy.y + 14, vx, vy, width: 6, height: 12, damage: 1 });
    return;
  }

  // event squad member: arc in from the bottom edge, out the top
  enemy.arcT = (enemy.arcT ?? 0) + dtSeconds / (enemy.arcDuration ?? 4.5);
  const t = Math.min(1, Math.max(0, enemy.arcT));
  enemy.y = ARENA_HEIGHT + 20 - t * (ARENA_HEIGHT + 60);
  enemy.x = (enemy.arcStartX ?? enemy.x) + Math.sin(t * Math.PI) * (enemy.arcAmplitude ?? 0);
}

export function isEnemyOffscreen(enemy: Enemy): boolean {
  if (enemy.kind === "charger") return enemy.y > ARENA_HEIGHT + 40;
  if (enemy.kind === "elite") return (enemy.formT ?? 0) > 1;
  return enemy.kind === "event" && (enemy.arcT ?? 0) > 1;
}

// The run is three rounds long. Each boss carries one 120hp bar per round, so
// the totals are 120 / 240 / 360 and every bar is the same size --- which is
// what makes "round 2 enrages below half" and "round 3 clones itself on its
// last bar" the same trigger: the final bar starting.
export const ROUNDS_TO_WIN = 3;
export const BOSS_BAR_HP = 120;

const ARCHETYPES: BossArchetype[] = ["summoner", "berserker", "twin"];
const ENRAGE_FLARE_MS = 900;
const BAR_BREAK_MS = 420;
const TELEGRAPH_MS = 1100;
const SUMMON_INTERVAL_MS = 4200;
const CHARGE_SPEED = 330;

export function createBoss(round: number): Boss {
  const bars = Math.max(1, Math.min(ROUNDS_TO_WIN, round));
  const hp = BOSS_BAR_HP * bars;
  return {
    x: ARENA_WIDTH / 2,
    y: 140,
    vx: 70 + (round - 1) * 16,
    hp,
    maxHp: hp,
    patternCooldownMs: 0,
    round,
    archetype: ARCHETYPES[Math.min(round, ROUNDS_TO_WIN) - 1],
    bars,
    barIndex: bars,
    volley: 0,
    enraged: false,
    enrageMs: 0,
    flashMs: 0,
    telegraphs: [],
    summonMs: 2200,
    clone: null,
  };
}

export function bossBarHp(boss: Boss): number {
  return boss.maxHp / boss.bars;
}

/** Which bar is draining, counting down --- 1 is always the last one. */
export function bossBarIndex(boss: Boss): number {
  return Math.max(1, Math.ceil(boss.hp / bossBarHp(boss)));
}

export type BossTransition = "enrage" | "clone" | "bar-break";

/** Applies whatever the boss's latest damage just triggered, and says what it
 * was so the caller can make a noise about it. Called from collision.ts, where
 * hp actually changes, because this module has no access to game state or the
 * event queue and shouldn't get any. */
export function advanceBossPhase(boss: Boss): BossTransition | null {
  const index = bossBarIndex(boss);
  if (index >= boss.barIndex) return null;
  boss.barIndex = index;
  boss.flashMs = BAR_BREAK_MS;

  // Each round keeps everything the last one had, so the triggers are stated
  // as thresholds rather than as archetypes. Round 2 (two bars) enrages on its
  // last bar, which is also its half; round 3 (three bars) enrages one bar
  // earlier and then splits on its last, so its final bar is an enraged twin.
  if (index === 1 && boss.round >= 3 && !boss.clone) {
    boss.clone = { x: ARENA_WIDTH - boss.x, y: boss.y };
    return "clone";
  }
  if (index <= boss.bars - 1 && boss.round >= 2 && !boss.enraged) {
    boss.enraged = true;
    boss.enrageMs = ENRAGE_FLARE_MS;
    // Cut whatever it was waiting on, so the flare is followed by fire rather
    // than by a suspiciously calm second.
    boss.patternCooldownMs = Math.min(boss.patternCooldownMs, 420);
    return "enrage";
  }
  return "bar-break";
}

/** Both bodies for a twin that has split, one otherwise. */
export function bossBodies(boss: Boss): Array<{ x: number; y: number }> {
  return boss.clone ? [boss, boss.clone] : [boss];
}

export function createCharger(x: number, index: number): Enemy {
  return {
    kind: "charger",
    x,
    // Stacked above the arena so a lane arrives as a column, not a single ship.
    y: -40 - index * 46,
    vx: 0,
    vy: CHARGE_SPEED,
    speed: CHARGE_SPEED,
    hp: 3,
    fireCooldownMs: Number.POSITIVE_INFINITY,
    fireIntervalMs: Number.POSITIVE_INFINITY,
    dirChangeMs: Number.POSITIVE_INFINITY,
  };
}

function pushOrb(bullets: Bullet[], x: number, y: number, angle: number, speed: number, size: number): void {
  bullets.push({
    owner: "enemy",
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    width: size,
    height: size,
    damage: 1,
  });
}

export type BossPattern = "aimed" | "spiral" | "pulse";

/** Every pattern a boss of this round knows. A round inherits the previous
 * rounds' whole repertoire and adds one, so round 3 fights with all three and
 * cycles between them --- which is also why the volley interval is a property
 * of the pattern rather than of the boss. */
export function bossPatterns(round: number): BossPattern[] {
  const patterns: BossPattern[] = ["aimed"];
  if (round >= 2) patterns.push("spiral");
  if (round >= 3) patterns.push("pulse");
  return patterns;
}

function currentPattern(boss: Boss): BossPattern {
  const patterns = bossPatterns(boss.round);
  return patterns[boss.volley % patterns.length];
}

function volleyIntervalMs(boss: Boss): number {
  const base = currentPattern(boss) === "aimed" ? 1200 : 950;
  return boss.enraged ? base * 0.45 : base;
}

/** Deliberately different shapes, not the same shape with a different count:
 * an aimed fan you sidestep, a spiral you read the rotation of, and a pulse
 * you find the gap in. Both twin bodies fire every pattern, in lockstep. */
function fireVolley(boss: Boss, bullets: Bullet[], playerX: number, playerY: number): void {
  const pattern = currentPattern(boss);
  const bodies = bossBodies(boss);

  if (pattern === "aimed") {
    const arm = boss.enraged ? 2 : 1;
    for (const body of bodies) {
      const base = Math.atan2(playerY - body.y, playerX - body.x);
      for (let i = -arm; i <= arm; i++) pushOrb(bullets, body.x, body.y, base + i * 0.18, 210, 8);
    }
    return;
  }

  if (pattern === "spiral") {
    const count = boss.enraged ? 14 : 11;
    const spin = boss.volley * (boss.enraged ? 0.55 : 0.32);
    // Enraged it throws a second arm winding the other way, so the readable
    // one-way spiral becomes a lattice.
    const arms = boss.enraged ? [1, -1] : [1];
    for (const body of bodies) {
      for (const dir of arms) {
        for (let i = 0; i < count; i++) {
          const angle = dir * spin + (i / count) * Math.PI * 2;
          pushOrb(bullets, body.x, body.y, angle, boss.enraged ? 250 : 205, boss.enraged ? 10 : 8);
        }
      }
    }
    return;
  }

  // pulse: a ring, half-step rotated every other volley so the gaps move.
  const count = 12;
  const offset = (boss.volley % 2) * (Math.PI / count);
  for (const body of bodies) {
    for (let i = 0; i < count; i++) {
      pushOrb(bullets, body.x, body.y, offset + (i / count) * Math.PI * 2, 200, 9);
    }
  }
}

/** Marks lanes, then --- a beat later --- sends a column of chargers down each
 * marked lane. Nothing spawns on the frame a lane is marked, which is the
 * whole point and is what spec/boss.test.ts pins down. */
function updateSummons(boss: Boss, dtMs: number, enemies: Enemy[]): void {
  if (boss.telegraphs.length > 0) {
    const due: Telegraph[] = [];
    const pending: Telegraph[] = [];
    for (const lane of boss.telegraphs) {
      lane.msLeft -= dtMs;
      (lane.msLeft <= 0 ? due : pending).push(lane);
    }
    for (const lane of due) {
      for (let i = 0; i < 3; i++) enemies.push(createCharger(lane.x, i));
    }
    boss.telegraphs = pending;
  }

  boss.summonMs -= dtMs;
  if (boss.summonMs > 0) return;
  boss.summonMs = SUMMON_INTERVAL_MS;
  for (let i = 0; i < 2; i++) {
    const x = PATROL_MARGIN + Math.random() * (ARENA_WIDTH - PATROL_MARGIN * 2);
    boss.telegraphs.push({ x, msLeft: TELEGRAPH_MS, totalMs: TELEGRAPH_MS, rising: false });
  }
}

export function updateBoss(
  boss: Boss,
  dtSeconds: number,
  dtMs: number,
  bullets: Bullet[],
  enemies: Enemy[],
  playerX: number,
  playerY: number,
): void {
  if (boss.flashMs > 0) boss.flashMs = Math.max(0, boss.flashMs - dtMs);
  if (boss.enrageMs > 0) boss.enrageMs = Math.max(0, boss.enrageMs - dtMs);

  boss.x += boss.vx * (boss.enraged ? 1.7 : 1) * dtSeconds;
  if (boss.x < 80 || boss.x > ARENA_WIDTH - 80) boss.vx *= -1;
  if (boss.clone) {
    boss.clone.x = ARENA_WIDTH - boss.x;
    boss.clone.y = boss.y;
  }

  // Every round summons, not just round 1: the lane charges are round 1's
  // contribution to a repertoire each later boss inherits whole.
  updateSummons(boss, dtMs, enemies);

  boss.patternCooldownMs -= dtMs;
  if (boss.patternCooldownMs > 0) return;
  boss.patternCooldownMs = volleyIntervalMs(boss);
  boss.volley += 1;
  fireVolley(boss, bullets, playerX, playerY);
}

export function updateBullet(bullet: Bullet, dtSeconds: number): void {
  bullet.x += bullet.vx * dtSeconds;
  bullet.y += bullet.vy * dtSeconds;
}

export function isBulletOffscreen(bullet: Bullet): boolean {
  return bullet.y < -20 || bullet.y > ARENA_HEIGHT + 20 || bullet.x < -20 || bullet.x > ARENA_WIDTH + 20;
}

export function createPowerUp(kind: PowerUpKind, x: number, y: number): PowerUp {
  return { kind, x, y, vx: 0, vy: 60 };
}

/** Drifts in from a random screen edge instead of dropping from a kill. */
export function createEdgePowerUp(kind: PowerUpKind): PowerUp {
  const fromLeft = Math.random() < 0.5;
  return {
    kind,
    x: fromLeft ? -20 : ARENA_WIDTH + 20,
    y: 80 + Math.random() * (UPPER_HALF - 80),
    vx: (fromLeft ? 1 : -1) * 40,
    vy: 20,
  };
}

export function updatePowerUp(powerUp: PowerUp, dtSeconds: number): void {
  powerUp.x += powerUp.vx * dtSeconds;
  powerUp.y += powerUp.vy * dtSeconds;
}

export function isPowerUpOffscreen(powerUp: PowerUp): boolean {
  return powerUp.y > ARENA_HEIGHT + 20 || powerUp.x < -40 || powerUp.x > ARENA_WIDTH + 40;
}

/** The gun widens one lane at a time, and stops.
 *
 * It used to double — and doubling is a trap that only shows up once a run is
 * long enough to collect from. With the round clock holding each round to
 * ROUND_MIN_MS and drops front-loaded, a measured run finished on multiplier
 * 64: 64 bullets per lane per shot, three inherited boss patterns invisible
 * because all three bosses died in nine seconds between them, and a screen so
 * full of the player's own fire that nothing else could be read through it.
 * Additive with a ceiling keeps the pickup worth taking without turning the
 * last two thirds of the run into a formality. */
const MULTIPLIER_CAP = 6;

/** Takes the whole player, not just the weapon: repair is the first pickup
 * that isn't a gun upgrade. Returns whether it actually did anything, so the
 * caller can tell a real pickup from a wasted one. */
export function applyPowerUp(player: Player, kind: PowerUpKind): boolean {
  if (kind === "laser") player.weapon.laser = true;
  else if (kind === "diagonal") player.weapon.diagonals = true;
  else if (kind === "multiply") {
    if (player.weapon.multiplier >= MULTIPLIER_CAP) return false;
    player.weapon.multiplier += 1;
  } else if (kind === "repair") {
    if (player.lives >= player.maxLives) return false;
    player.lives += 1;
  }
  return true;
}

const WEAPON_POWERUP_KINDS: PowerUpKind[] = ["laser", "diagonal", "multiply"];

/** Repair only exists when it would do something. Offering a life back to a
 * player on full lives is a pickup that teaches you pickups can be worthless,
 * and the three-round run is short enough that a wasted drop is expensive.
 *
 * Its share of drops climbs with how much damage the player is actually
 * carrying: a flat 30% was too thin from round 2 on, where the fights are
 * longer and a player arrives already down. By three lives lost, over half of
 * what drops is a repair. */
export function randomPowerUpKind(livesMissing = 0): PowerUpKind {
  const repairShare = Math.min(0.55, 0.22 + 0.13 * livesMissing);
  if (livesMissing > 0 && Math.random() < repairShare) return "repair";
  return WEAPON_POWERUP_KINDS[Math.floor(Math.random() * WEAPON_POWERUP_KINDS.length)];
}

export type ExplosionKind = "enemy" | "boss";

export const EXPLOSION_FRAME_COUNT = 6;
const EXPLOSION_FRAME_MS = 70;

export interface Explosion {
  kind: ExplosionKind;
  x: number;
  y: number;
  frame: number;
  frameMs: number;
}

export function createExplosion(kind: ExplosionKind, x: number, y: number): Explosion {
  return { kind, x, y, frame: 0, frameMs: EXPLOSION_FRAME_MS };
}

export function updateExplosion(explosion: Explosion, dtMs: number): void {
  explosion.frameMs -= dtMs;
  while (explosion.frameMs <= 0 && explosion.frame < EXPLOSION_FRAME_COUNT) {
    explosion.frame += 1;
    explosion.frameMs += EXPLOSION_FRAME_MS;
  }
}

export function isExplosionDone(explosion: Explosion): boolean {
  return explosion.frame >= EXPLOSION_FRAME_COUNT;
}
