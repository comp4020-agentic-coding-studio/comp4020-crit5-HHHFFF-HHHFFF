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
// telegraphed.
export type EnemyKind = "normal" | "event" | "charger";

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
}

// Three rounds, three different fights. The archetype is what makes a round
// its own encounter rather than the same boss with a bigger number: each one
// fires on its own logic and carries one signature mechanic.
export type BossArchetype = "summoner" | "berserker" | "twin";

/** A lane the summoner has marked but not yet charged down. The warning is the
 * mechanic --- a dive out of nowhere is unfair, the same dive announced a
 * second early is a dodge you either make or don't. */
export interface BossTelegraph {
  x: number;
  msLeft: number;
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
  telegraphs: BossTelegraph[];
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

export type PowerUpKind = "laser" | "diagonal" | "multiply";

export interface PowerUp {
  kind: PowerUpKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function createPlayer(shipIndex: number): Player {
  const ship = SHIPS[shipIndex] ?? SHIPS[0];
  return {
    x: ARENA_WIDTH / 2,
    y: ARENA_HEIGHT - 90,
    ship,
    lives: 3,
    maxLives: 3,
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
    fireIntervalMs: (1700 + Math.random() * 1800) / Math.min(3, difficulty),
    dirChangeMs: 0,
  };
  retarget(enemy);
  return enemy;
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
      // just faster singles.
      const shots = difficulty >= 3 ? 3 : difficulty >= 2 ? 2 : 1;
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

  // event squad member: arc in from the bottom edge, out the top
  enemy.arcT = (enemy.arcT ?? 0) + dtSeconds / (enemy.arcDuration ?? 4.5);
  const t = Math.min(1, Math.max(0, enemy.arcT));
  enemy.y = ARENA_HEIGHT + 20 - t * (ARENA_HEIGHT + 60);
  enemy.x = (enemy.arcStartX ?? enemy.x) + Math.sin(t * Math.PI) * (enemy.arcAmplitude ?? 0);
}

export function isEnemyOffscreen(enemy: Enemy): boolean {
  if (enemy.kind === "charger") return enemy.y > ARENA_HEIGHT + 40;
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

  if (index === 1 && boss.archetype === "berserker" && !boss.enraged) {
    boss.enraged = true;
    boss.enrageMs = ENRAGE_FLARE_MS;
    // Cut whatever it was waiting on, so the flare is followed by fire rather
    // than by a suspiciously calm second.
    boss.patternCooldownMs = Math.min(boss.patternCooldownMs, 420);
    return "enrage";
  }
  if (index === 1 && boss.archetype === "twin" && !boss.clone) {
    boss.clone = { x: ARENA_WIDTH - boss.x, y: boss.y };
    return "clone";
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

function volleyIntervalMs(boss: Boss): number {
  if (boss.archetype === "summoner") return 1400;
  if (boss.archetype === "berserker") return boss.enraged ? 380 : 900;
  return 1100;
}

/** Each archetype's volley. Deliberately different shapes, not the same shape
 * with a different count: an aimed fan you sidestep, a spiral you read the
 * rotation of, and a pulse you find the gap in. */
function fireVolley(boss: Boss, bullets: Bullet[], playerX: number, playerY: number): void {
  if (boss.archetype === "summoner") {
    // Sparse and aimed. The lane charges are this fight's pressure; a wall of
    // bullets on top of them would leave nowhere to stand.
    const base = Math.atan2(playerY - boss.y, playerX - boss.x);
    for (let i = -1; i <= 1; i++) pushOrb(bullets, boss.x, boss.y, base + i * 0.18, 210, 8);
    return;
  }

  if (boss.archetype === "berserker") {
    const count = boss.enraged ? 14 : 11;
    const spin = boss.volley * (boss.enraged ? 0.55 : 0.32);
    // Enraged it throws a second arm winding the other way, so the readable
    // one-way spiral becomes a lattice.
    const arms = boss.enraged ? [1, -1] : [1];
    for (const dir of arms) {
      for (let i = 0; i < count; i++) {
        const angle = dir * spin + (i / count) * Math.PI * 2;
        pushOrb(bullets, boss.x, boss.y, angle, boss.enraged ? 250 : 205, boss.enraged ? 10 : 8);
      }
    }
    return;
  }

  // twin: ring pulses, half-step rotated every other volley so the gaps move.
  const count = 12;
  const offset = (boss.volley % 2) * (Math.PI / count);
  for (const body of bossBodies(boss)) {
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
    const due: BossTelegraph[] = [];
    const pending: BossTelegraph[] = [];
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
    boss.telegraphs.push({ x, msLeft: TELEGRAPH_MS });
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

  if (boss.archetype === "summoner") updateSummons(boss, dtMs, enemies);

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

export function applyPowerUp(weapon: WeaponState, kind: PowerUpKind): void {
  if (kind === "laser") weapon.laser = true;
  else if (kind === "diagonal") weapon.diagonals = true;
  else weapon.multiplier *= 2;
}

const POWERUP_KINDS: PowerUpKind[] = ["laser", "diagonal", "multiply"];

export function randomPowerUpKind(): PowerUpKind {
  return POWERUP_KINDS[Math.floor(Math.random() * POWERUP_KINDS.length)];
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
