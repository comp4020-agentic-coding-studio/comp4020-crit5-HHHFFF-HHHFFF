// Per-frame collision resolution. This is the layer that turns "a bullet
// overlaps the player" into an actual phase transition — it calls straight
// into state.ts's hitPlayer/registerKill/defeatBoss, the same functions
// window.harness calls, so nothing here is a parallel implementation of
// what those mean.

import {
  applyPowerUp,
  createExplosion,
  createPowerUp,
  isBulletOffscreen,
  isEnemyOffscreen,
  isExplosionDone,
  isPowerUpOffscreen,
  randomPowerUpKind,
  updateBullet,
  updateEnemy,
  updateExplosion,
  updatePowerUp,
} from "./entities";
import { advanceBossPhase, bossBodies } from "./entities";
import { currentDifficulty, defeatBoss, hitPlayer, pushEvent, registerKill, state } from "./state";

const PLAYER_RADIUS = 16;
const ENEMY_RADIUS = 14;
const BOSS_RADIUS = 40;
const PLAYER_INVULNERABLE_MS = 500;
// Drops are generous for the first stretch and then settle to the old rate.
// Flat 0.12 meant an unlucky opening left you on the base gun going into a
// 120hp round-1 boss, which is a long fight with nothing to show for it; the
// run is only three rounds now, so the opening is where the tools have to
// arrive. Late drops stay rare enough to notice.
const POWERUP_DROP_CHANCE = 0.12;
const POWERUP_EARLY_BONUS = 0.12;
const POWERUP_EASE_MS = 90000;

function powerUpDropChance(): number {
  const eased = Math.max(0, 1 - state.elapsedMs / POWERUP_EASE_MS);
  return POWERUP_DROP_CHANCE + POWERUP_EARLY_BONUS * eased;
}

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

  // enemy ships ramming the player: a hit for the player, destroys the enemy
  if (player.invulnerableMs <= 0) {
    for (const enemy of state.enemies) {
      if (circleHit(enemy.x, enemy.y, ENEMY_RADIUS, player.x, player.y, PLAYER_RADIUS)) {
        hitPlayer();
        player.invulnerableMs = PLAYER_INVULNERABLE_MS;
        enemy.hp = 0;
        break;
      }
    }
  }

  // player bullets vs enemies
  for (const enemy of state.enemies) {
    for (const bullet of state.bullets) {
      if (bullet.owner !== "player") continue;
      if (circleHit(bullet.x, bullet.y, bullet.width / 2, enemy.x, enemy.y, ENEMY_RADIUS)) {
        enemy.hp -= bullet.damage;
        bullet.y = -9999;
      }
    }
  }

  // player bullets vs boss --- and vs its clone, which shares the same hp, so
  // a player who picks the "wrong" one of the two bodies still gets paid.
  const boss = state.boss;
  if (boss) {
    for (const bullet of state.bullets) {
      if (bullet.owner !== "player") continue;
      for (const body of bossBodies(boss)) {
        if (!circleHit(bullet.x, bullet.y, bullet.width / 2, body.x, body.y, BOSS_RADIUS)) continue;
        boss.hp -= bullet.damage;
        bullet.y = -9999;
        break;
      }
    }

    // A bar emptying is a beat of its own: the screen clears, the boss flashes,
    // and round 2 or 3 turns whatever it turns into. Without the clear, the
    // spiral already in the air lands on top of the new pattern.
    const transition = advanceBossPhase(boss);
    if (transition) {
      state.bullets = state.bullets.filter((bullet) => bullet.owner === "player");
      if (transition === "enrage") pushEvent({ type: "enrage" });
    }

    if (boss.hp <= 0) {
      const bodies = bossBodies(boss).map((body) => ({ x: body.x, y: body.y }));
      defeatBoss();
      for (const body of bodies) state.explosions.push(createExplosion("boss", body.x, body.y));
      pushEvent({ type: "explosion", kind: "boss" });
    }
  }

  // dead enemies: drop a chance of a power-up, count towards the boss meter
  const survivors = [];
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) {
      state.explosions.push(createExplosion("enemy", enemy.x, enemy.y));
      pushEvent({ type: "explosion", kind: "enemy" });
      if (enemy.kind === "normal") {
        registerKill();
        if (Math.random() < powerUpDropChance()) {
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
  const difficulty = currentDifficulty();
  for (const enemy of state.enemies) updateEnemy(enemy, dtSeconds, dtMs, state.bullets, player.x, difficulty);
}

export function stepExplosions(dtMs: number): void {
  for (const explosion of state.explosions) updateExplosion(explosion, dtMs);
  state.explosions = state.explosions.filter((explosion) => !isExplosionDone(explosion));
}
