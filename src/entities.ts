// Entity types and their per-frame update logic. Nothing here touches game
// state directly — every function takes the arrays/objects it operates on as
// arguments, so this module has no notion of phases, progress or win/loss.
// That split is what let spec/ending.test.ts be written before any of this
// existed: state.ts and harness.ts didn't need any of it to compile.

export const ARENA_WIDTH = 480;
export const ARENA_HEIGHT = 800;
export const UPPER_HALF = ARENA_HEIGHT * 0.55;

export interface ShipDef {
  name: string;
  color: string;
  speed: number; // px/s
  fireIntervalMs: number;
  bulletSpeed: number; // px/s
  blurb: string;
}

export const SHIPS: ShipDef[] = [
  {
    name: "Interceptor",
    color: "#4fd1ff",
    speed: 260,
    fireIntervalMs: 180,
    bulletSpeed: 480,
    blurb: "Fast, fragile, average fire rate.",
  },
  {
    name: "Bulwark",
    color: "#ffb84f",
    speed: 170,
    fireIntervalMs: 220,
    bulletSpeed: 480,
    blurb: "Slow, tankier feel, wider bullets.",
  },
  {
    name: "Striker",
    color: "#ff5f7e",
    speed: 220,
    fireIntervalMs: 120,
    bulletSpeed: 520,
    blurb: "Balanced speed, rapid fire.",
  },
];

export interface WeaponState {
  diagonals: boolean;
  laser: boolean;
  multiplier: number;
}

export interface Player {
  x: number;
  y: number;
  ship: ShipDef;
  lives: number;
  maxLives: number;
  weapon: WeaponState;
  fireCooldownMs: number;
  invulnerableMs: number;
}

export type EnemyKind = "normal" | "event";

export interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  hp: number;
  fireCooldownMs: number;
  fireIntervalMs: number;
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

/** Auto-fire: nothing for the player to discover, per the no-tutorial spec line. */
export function updatePlayerFiring(player: Player, dtMs: number, bullets: Bullet[]): void {
  player.fireCooldownMs -= dtMs;
  if (player.fireCooldownMs > 0) return;
  player.fireCooldownMs = player.ship.fireIntervalMs;

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
        width: player.weapon.laser ? 10 : 4,
        height: player.weapon.laser ? 28 : 12,
        damage: player.weapon.laser ? 2 : 1,
      });
    }
  }
}

export function createNormalEnemy(): Enemy {
  const fromLeft = Math.random() < 0.5;
  return {
    kind: "normal",
    x: fromLeft ? 40 : ARENA_WIDTH - 40,
    y: 60 + Math.random() * (UPPER_HALF - 100),
    vx: (fromLeft ? 1 : -1) * (60 + Math.random() * 40),
    hp: 2,
    fireCooldownMs: 1000 + Math.random() * 1500,
    fireIntervalMs: 2000 + Math.random() * 2000,
  };
}

export function createEventSquadMember(index: number, startX: number): Enemy {
  return {
    kind: "event",
    x: startX,
    y: ARENA_HEIGHT + 20,
    vx: 0,
    hp: 1,
    fireCooldownMs: Number.POSITIVE_INFINITY,
    fireIntervalMs: Number.POSITIVE_INFINITY,
    arcT: -index * 0.12,
    arcDuration: 4.5,
    arcStartX: startX,
    arcAmplitude: 90 * (startX < ARENA_WIDTH / 2 ? 1 : -1),
  };
}

export function updateEnemy(enemy: Enemy, dtSeconds: number, dtMs: number, bullets: Bullet[], playerX: number): void {
  if (enemy.kind === "normal") {
    enemy.x += enemy.vx * dtSeconds;
    if (enemy.x < 30 || enemy.x > ARENA_WIDTH - 30) enemy.vx *= -1;

    enemy.fireCooldownMs -= dtMs;
    if (enemy.fireCooldownMs <= 0) {
      enemy.fireCooldownMs = enemy.fireIntervalMs;
      const vy = 180;
      const vx = ((playerX - enemy.x) / ARENA_HEIGHT) * vy;
      bullets.push({ owner: "enemy", x: enemy.x, y: enemy.y + 16, vx, vy, width: 6, height: 12, damage: 1 });
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

export function createBoss(): Boss {
  return {
    x: ARENA_WIDTH / 2,
    y: 140,
    vx: 70,
    hp: 40,
    maxHp: 40,
    patternCooldownMs: 0,
    pattern: "radial",
  };
}

const BOSS_PATTERNS: BossPattern[] = ["radial", "aimed", "spread"];

export function updateBoss(boss: Boss, dtSeconds: number, dtMs: number, bullets: Bullet[], playerX: number, playerY: number): void {
  boss.x += boss.vx * dtSeconds;
  if (boss.x < 80 || boss.x > ARENA_WIDTH - 80) boss.vx *= -1;

  boss.patternCooldownMs -= dtMs;
  if (boss.patternCooldownMs > 0) return;
  boss.patternCooldownMs = 1500;
  boss.pattern = BOSS_PATTERNS[(BOSS_PATTERNS.indexOf(boss.pattern) + 1) % BOSS_PATTERNS.length];

  const speed = 200;
  if (boss.pattern === "radial") {
    const count = 10;
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
    for (let i = -1; i <= 1; i++) {
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
    const count = 5;
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
