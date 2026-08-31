// Per-frame collision resolution. This is the layer that turns "a bullet
// overlaps the player" into an actual phase transition — it calls straight
// into state.ts's hitPlayer/registerKill/defeatBoss, the same functions
// window.harness calls, so nothing here is a parallel implementation of
// what those mean.

import {
  applyPowerUp,
  createPowerUp,
  isBulletOffscreen,
  isEnemyOffscreen,
  isPowerUpOffscreen,
  randomPowerUpKind,
  updateBullet,
  updateEnemy,
  updatePowerUp,
} from "./entities";
import { defeatBoss, hitPlayer, registerKill, state } from "./state";

const PLAYER_RADIUS = 16;
const PLAYER_INVULNERABLE_MS = 500;
const POWERUP_DROP_CHANCE = 0.35;

function circleHit(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy <= (ar + br) * (ar + br);
}

export function stepBulletsAndCollisions(dtSeconds: number, dtMs: number): void {
  const player = state.player;
  if (!player) return;

  for (const bullet of state.bullets) updateBullet(bullet, dtSeconds);

  // enemy bullets vs player
  if (player.invulnerableMs <= 0) {
    for (const bullet of state.bullets) {
      if (bullet.owner !== "enemy") continue;
      if (circleHit(bullet.x, bullet.y, bullet.width / 2, player.x, player.y, PLAYER_RADIUS)) {
        hitPlayer();
        player.invulnerableMs = PLAYER_INVULNERABLE_MS;
        bullet.y = -9999; // swept away below
        break;
      }
    }
  }

  // player bullets vs enemies
  for (const enemy of state.enemies) {
    for (const bullet of state.bullets) {
      if (bullet.owner !== "player") continue;
      if (circleHit(bullet.x, bullet.y, bullet.width / 2, enemy.x, enemy.y, 14)) {
        enemy.hp -= bullet.damage;
        bullet.y = -9999;
      }
    }
  }

  // player bullets vs boss
  if (state.boss) {
    for (const bullet of state.bullets) {
      if (bullet.owner !== "player") continue;
      if (circleHit(bullet.x, bullet.y, bullet.width / 2, state.boss.x, state.boss.y, 40)) {
        state.boss.hp -= bullet.damage;
        bullet.y = -9999;
      }
    }
    if (state.boss.hp <= 0) defeatBoss();
  }

  // dead enemies: drop a chance of a power-up, count towards the boss meter
  const survivors = [];
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) {
      if (enemy.kind === "normal") {
        registerKill();
        if (Math.random() < POWERUP_DROP_CHANCE) {
          state.powerUps.push(createPowerUp(randomPowerUpKind(), enemy.x, enemy.y));
        }
      }
      continue;
    }
    if (isEnemyOffscreen(enemy)) continue;
    survivors.push(enemy);
  }
  state.enemies = survivors;

  state.bullets = state.bullets.filter((bullet) => !isBulletOffscreen(bullet));

  for (const powerUp of state.powerUps) updatePowerUp(powerUp, dtSeconds);
  const remainingPowerUps = [];
  for (const powerUp of state.powerUps) {
    if (circleHit(powerUp.x, powerUp.y, 12, player.x, player.y, PLAYER_RADIUS)) {
      applyPowerUp(player.weapon, powerUp.kind);
      continue;
    }
    if (isPowerUpOffscreen(powerUp)) continue;
    remainingPowerUps.push(powerUp);
  }
  state.powerUps = remainingPowerUps;
}

export function stepEnemyMovement(dtSeconds: number, dtMs: number): void {
  const player = state.player;
  if (!player) return;
  for (const enemy of state.enemies) updateEnemy(enemy, dtSeconds, dtMs, state.bullets, player.x);
}
