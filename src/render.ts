// Canvas draw routines. Every shape is keyed off entity type + size, not
// hand-positioned per asset — swapping placeholder shapes for real sprites
// later is a change to this file only, not to game logic. (That swap has now
// happened: every entity below draws from src/assets.ts instead of a vector
// shape.)

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  type Boss,
  type Bullet,
  type Enemy,
  type Explosion,
  type Player,
  type PowerUp,
} from "./entities";
import { images, SHIP_SPRITES } from "./assets";

const POWERUP_IMAGES: Record<PowerUp["kind"], HTMLImageElement> = {
  laser: images.powerupLaser,
  diagonal: images.powerupDiagonal,
  multiply: images.powerupMultiply,
};

const EXPLOSION_FRAME_WIDTH = 362;
const EXPLOSION_FRAME_HEIGHT = 724;

/** `drawImage` on an image whose data hasn't arrived yet is a no-op in every
 * engine, but `.complete` lets us skip the call entirely rather than rely on
 * that per-engine behavior. */
function drawCentered(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (!img.complete || img.naturalWidth === 0) return;
  ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
}

function drawSliceCentered(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (!img.complete || img.naturalWidth === 0) return;
  ctx.drawImage(img, sx, sy, sw, sh, x - w / 2, y - h / 2, w, h);
}

export function clear(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
  const bg = images.background;
  if (bg.complete && bg.naturalWidth > 0) {
    ctx.drawImage(bg, 0, 0, ARENA_WIDTH, ARENA_HEIGHT);
  }
}

export function drawPlayer(ctx: CanvasRenderingContext2D, player: Player): void {
  ctx.save();
  ctx.globalAlpha = player.invulnerableMs > 0 && Math.floor(player.invulnerableMs / 80) % 2 === 0 ? 0.35 : 1;
  drawCentered(ctx, SHIP_SPRITES[player.ship.key], player.x, player.y, 48, 48);
  ctx.restore();
}

export function drawEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
  const img = enemy.kind === "event" ? images.enemyEvent : images.enemyNormal;
  drawCentered(ctx, img, enemy.x, enemy.y, 40, 40);
}

export function drawBoss(ctx: CanvasRenderingContext2D, boss: Boss): void {
  drawCentered(ctx, images.boss, boss.x, boss.y, 120, 120);

  const barWidth = 200;
  const x = ARENA_WIDTH / 2 - barWidth / 2;
  ctx.fillStyle = "#2a0f16";
  ctx.fillRect(x, 24, barWidth, 10);
  ctx.fillStyle = "#ff3b6b";
  ctx.fillRect(x, 24, barWidth * Math.max(0, boss.hp / boss.maxHp), 10);
}

export function drawBullet(ctx: CanvasRenderingContext2D, bullet: Bullet): void {
  if (bullet.owner === "player") {
    const isLaser = bullet.width >= 10;
    const sy = isLaser ? 768 : 0;
    const [w, h] = isLaser ? [20, 44] : [12, 30];
    drawSliceCentered(ctx, images.bulletPlayer, 0, sy, 1024, 768, bullet.x, bullet.y, w, h);
    return;
  }

  const isRound = bullet.width === bullet.height;
  const sx = isRound ? 724 : 0;
  const [w, h] = isRound ? [18, 18] : [16, 28];
  drawSliceCentered(ctx, images.bulletEnemy, sx, 0, 724, 1086, bullet.x, bullet.y, w, h);
}

export function drawPowerUp(ctx: CanvasRenderingContext2D, powerUp: PowerUp): void {
  drawCentered(ctx, POWERUP_IMAGES[powerUp.kind], powerUp.x, powerUp.y, 28, 28);
}

export function drawExplosion(ctx: CanvasRenderingContext2D, explosion: Explosion): void {
  const img = explosion.kind === "boss" ? images.explosionBoss : images.explosionEnemy;
  const [w, h] = explosion.kind === "boss" ? [90, 180] : [48, 96];
  drawSliceCentered(
    ctx,
    img,
    explosion.frame * EXPLOSION_FRAME_WIDTH,
    0,
    EXPLOSION_FRAME_WIDTH,
    EXPLOSION_FRAME_HEIGHT,
    explosion.x,
    explosion.y,
    w,
    h,
  );
}

export function drawProgressBar(ctx: CanvasRenderingContext2D, progress: number): void {
  const width = 140;
  const x = ARENA_WIDTH - width - 16;
  ctx.fillStyle = "#101526";
  ctx.fillRect(x, 16, width, 10);
  ctx.fillStyle = "#4fd1ff";
  ctx.fillRect(x, 16, width * progress, 10);
}

export function drawLives(ctx: CanvasRenderingContext2D, lives: number, maxLives: number): void {
  ctx.fillStyle = "#ff5f7e";
  for (let i = 0; i < maxLives; i++) {
    ctx.globalAlpha = i < lives ? 1 : 0.2;
    ctx.beginPath();
    ctx.arc(24 + i * 22, 22, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawEndBanner(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.fillStyle = "rgba(5, 7, 13, 0.6)";
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
  ctx.fillStyle = "#f4f6ff";
  ctx.font = "bold 32px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
}
