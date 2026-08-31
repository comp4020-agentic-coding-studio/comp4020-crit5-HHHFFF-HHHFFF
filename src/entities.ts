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

export type EnemyKind = "normal" | "event";

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

export type BossPattern = "radial" | "aimed" | "spread";

export interface Boss {
  x: number;
  y: number;
  vx: number;
  hp: number;
  maxHp: number;
  patternCooldownMs: number;
  pattern: BossPattern;
  round: number; // 1-based; endless mode keeps handing out tougher ones
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

  // event squad member: arc in from the bottom edge, out the top
  enemy.arcT = (enemy.arcT ?? 0) + dtSeconds / (enemy.arcDuration ?? 4.5);
  const t = Math.min(1, Math.max(0, enemy.arcT));
  enemy.y = ARENA_HEIGHT + 20 - t * (ARENA_HEIGHT + 60);
  enemy.x = (enemy.arcStartX ?? enemy.x) + Math.sin(t * Math.PI) * (enemy.arcAmplitude ?? 0);
}

export function isEnemyOffscreen(enemy: Enemy): boolean {
  return enemy.kind === "event" && (enemy.arcT ?? 0) > 1;
}

export function createBoss(round: number): Boss {
  const hp = 40 + (round - 1) * 25;
  return {
    x: ARENA_WIDTH / 2,
    y: 140,
    vx: 70 + (round - 1) * 16,
    hp,
    maxHp: hp,
    patternCooldownMs: 0,
    pattern: "radial",
    round,
  };
}

const BOSS_PATTERNS: BossPattern[] = ["radial", "aimed", "spread"];

export function updateBoss(
  boss: Boss,
  dtSeconds: number,
  dtMs: number,
  bullets: Bullet[],
  playerX: number,
  playerY: number,
): void {
  boss.x += boss.vx * dtSeconds;
  if (boss.x < 80 || boss.x > ARENA_WIDTH - 80) boss.vx *= -1;

  boss.patternCooldownMs -= dtMs;
  if (boss.patternCooldownMs > 0) return;
  // Later rounds cycle patterns faster and throw more per volley. Both are
  // floored/capped so round 9 is brutal without being a solid wall.
  boss.patternCooldownMs = Math.max(650, 1500 - (boss.round - 1) * 150);
  boss.pattern = BOSS_PATTERNS[(BOSS_PATTERNS.indexOf(boss.pattern) + 1) % BOSS_PATTERNS.length];

  const extra = Math.min(6, boss.round - 1);
  const speed = 200 + extra * 20;
  if (boss.pattern === "radial") {
    const count = 10 + extra * 3;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      bullets.push({
        owner: "enemy",
        x: boss.x,
        y: boss.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        width: 8,
        height: 8,
        damage: 1,
      });
    }
  } else if (boss.pattern === "aimed") {
    const dx = playerX - boss.x;
    const dy = playerY - boss.y;
    const len = Math.hypot(dx, dy) || 1;
    const arm = 1 + Math.floor(extra / 2);
    for (let i = -arm; i <= arm; i++) {
      bullets.push({
        owner: "enemy",
        x: boss.x,
        y: boss.y,
        vx: (dx / len) * speed + i * 40,
        vy: (dy / len) * speed,
        width: 8,
        height: 8,
        damage: 1,
      });
    }
  } else {
    const count = 5 + extra * 2;
    for (let i = 0; i < count; i++) {
      const angle = Math.PI / 2 + ((i - (count - 1) / 2) * Math.PI) / 8;
      bullets.push({
        owner: "enemy",
        x: boss.x,
        y: boss.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        width: 8,
        height: 8,
        damage: 1,
      });
    }
  }
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
