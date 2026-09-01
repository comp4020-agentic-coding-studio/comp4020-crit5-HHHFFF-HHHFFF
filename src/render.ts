// Canvas draw routines. Every sprite is keyed off entity type + a target box,
// not hand-positioned per asset — which is what let the placeholder vector
// shapes be swapped for real art without touching game logic, and what lets
// every size below be tuned by changing one number.
//
// Sizes are given as a box to fit inside, never as an exact width and height:
// the measured source rects in assets.ts all have their own aspect ratios, and
// forcing a square destination on a 0.22-aspect bullet is what made the first
// pass look squashed.

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  type Boss,
  type Bullet,
  type Enemy,
  type Explosion,
  OVERDRIVE_MS,
  type Player,
  type PowerUp,
} from "./entities";
import {
  backgroundImage,
  BOSS_SPRITE,
  BULLET_SPRITES,
  ENEMY_SPRITES,
  EXPLOSION_SHEETS,
  POWERUP_SPRITES,
  SHIP_SPRITES,
  sheetFrame,
  type Sprite,
} from "./assets";

function ready(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

/** Draws a sprite centred on (cx, cy), scaled to fit inside boxW x boxH with
 * its own aspect ratio preserved. */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  spr: Sprite,
  cx: number,
  cy: number,
  boxW: number,
  boxH: number,
): void {
  if (!ready(spr.img)) return;
  const scale = Math.min(boxW / spr.sw, boxH / spr.sh);
  const w = spr.sw * scale;
  const h = spr.sh * scale;
  ctx.drawImage(spr.img, spr.sx, spr.sy, spr.sw, spr.sh, cx - w / 2, cy - h / 2, w, h);
}

// The backdrop art isn't tileable, so every second copy is drawn flipped: the
// join between a copy and its flipped neighbour is then image-bottom against
// image-bottom, and the join between one pair and the next is top against
// top. Both match pixel for pixel, so a 2 x ARENA_HEIGHT pair scrolls forever
// with no visible seam — which a naive repeat would show every 800px.
const BACKDROP_UNIT = ARENA_HEIGHT * 2;

function drawBackdropPair(ctx: CanvasRenderingContext2D, img: HTMLImageElement, top: number): void {
  if (top + BACKDROP_UNIT <= 0 || top >= ARENA_HEIGHT) return;
  ctx.drawImage(img, 0, top, ARENA_WIDTH, ARENA_HEIGHT);
  ctx.save();
  ctx.translate(0, top + BACKDROP_UNIT);
  ctx.scale(1, -1);
  ctx.drawImage(img, 0, 0, ARENA_WIDTH, ARENA_HEIGHT);
  ctx.restore();
}

export function clear(ctx: CanvasRenderingContext2D, scrollY: number): void {
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

  if (!ready(backgroundImage)) return;
  // Content moves *down* as scrollY grows, so the ship reads as flying up.
  const offset = ((scrollY % BACKDROP_UNIT) + BACKDROP_UNIT) % BACKDROP_UNIT;
  drawBackdropPair(ctx, backgroundImage, offset - BACKDROP_UNIT);
  drawBackdropPair(ctx, backgroundImage, offset);
}

// ---------- the page-wide backdrop ----------
//
// The arena is a fixed 480:800 shape, so on a wide desktop window it can only
// ever be a strip down the middle. Everything either side of it used to be
// flat black, which read as a small game on an empty page. This fills the
// whole viewport with the same starfield, so the window reads as space with a
// play field in it.
//
// It is the same art at the same texture size as the arena's own backdrop, but
// scrolled slower: a parallax layer that is obviously a further-away sky,
// rather than a near-miss attempt to line up with the arena, which would just
// invite the eye to check the seam. The arena stays brighter than it (see the
// dimming below), so the playable box is still the thing you look at.
const PARALLAX = 0.45;
const DIM = "rgba(5, 7, 13, 0.55)";

/** One scroll period of the tiling, prerendered. Redrawn only when the
 * viewport or the tile size changes: tiling straight onto the visible canvas
 * would rescale a 1.7MB PNG a dozen times a frame, every frame. */
let tileCache: HTMLCanvasElement | null = null;
let tileCacheKey = "";

function buildTile(width: number, tileW: number, tileH: number): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(tileH * 2));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Same mirroring trick as drawBackdropPair, now in both axes: every second
  // column is flipped horizontally and every second row vertically, so each
  // join is an edge against its own mirror image and matches pixel for pixel.
  // The art is not tileable, and a naive repeat seams visibly in both
  // directions on a wide window.
  for (let col = 0; col * tileW < canvas.width; col++) {
    for (let row = 0; row < 2; row++) {
      const flipX = col % 2 === 1;
      const flipY = row === 1;
      ctx.save();
      ctx.translate(col * tileW + (flipX ? tileW : 0), row * tileH + (flipY ? tileH : 0));
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(backgroundImage, 0, 0, tileW, tileH);
      ctx.restore();
    }
  }

  ctx.fillStyle = DIM;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Paints the scrolling starfield across the whole page, behind everything.
 * `tileW` is the arena's on-screen width, so the texture is the same size out
 * here as it is inside the play field. */
export function drawPageBackdrop(
  ctx: CanvasRenderingContext2D,
  scrollY: number,
  width: number,
  height: number,
  tileW: number,
): void {
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, width, height);
  if (!ready(backgroundImage) || tileW <= 0) return;

  const tileH = tileW * (ARENA_HEIGHT / ARENA_WIDTH);
  const key = `${Math.ceil(width)}x${Math.ceil(height)}@${Math.round(tileW)}`;
  if (key !== tileCacheKey) {
    tileCache = buildTile(width, tileW, tileH);
    tileCacheKey = tileCache ? key : "";
  }
  if (!tileCache) return;

  const unit = tileCache.height;
  const offset = (((scrollY * PARALLAX) % unit) + unit) % unit;
  for (let y = offset - unit; y < height; y += unit) ctx.drawImage(tileCache, 0, y);
}

export function drawPlayer(ctx: CanvasRenderingContext2D, player: Player): void {
  ctx.save();
  ctx.globalAlpha = player.invulnerableMs > 0 && Math.floor(player.invulnerableMs / 80) % 2 === 0 ? 0.35 : 1;

  if (player.overdriveMs > 0) {
    // A pulsing halo while the free laser runs — the only cue that the meter
    // paid out, since nothing was pressed to make it happen.
    const pulse = 0.5 + 0.5 * Math.sin(player.overdriveMs / 80);
    ctx.save();
    ctx.globalAlpha *= 0.2 + 0.22 * pulse;
    ctx.fillStyle = "#c8faff";
    ctx.beginPath();
    ctx.arc(player.x, player.y, 28 + pulse * 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawSprite(ctx, SHIP_SPRITES[player.ship.key], player.x, player.y, 46, 46);
  ctx.restore();
}

export function drawEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
  drawSprite(ctx, ENEMY_SPRITES[enemy.kind], enemy.x, enemy.y, 42, 42);
}

export function drawBoss(ctx: CanvasRenderingContext2D, boss: Boss): void {
  drawSprite(ctx, BOSS_SPRITE, boss.x, boss.y, 124, 124);

  const barWidth = 200;
  const x = ARENA_WIDTH / 2 - barWidth / 2;
  // Sits below the lives and the two right-hand meters so nothing overlaps.
  const y = 52;
  ctx.fillStyle = "#2a0f16";
  ctx.fillRect(x, y, barWidth, 10);
  ctx.fillStyle = "#ff3b6b";
  ctx.fillRect(x, y, barWidth * Math.max(0, boss.hp / boss.maxHp), 10);

  ctx.fillStyle = "#ff9ab4";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(`WAVE ${boss.round}`, ARENA_WIDTH / 2, y + 14);
}

export function drawBullet(ctx: CanvasRenderingContext2D, bullet: Bullet): void {
  if (bullet.owner === "player") {
    // width is the only thing that distinguishes the two player forms, and
    // it's already set by updatePlayerFiring — no extra field needed.
    if (bullet.width >= 10) drawSprite(ctx, BULLET_SPRITES.playerLaser, bullet.x, bullet.y, 18, 46);
    else drawSprite(ctx, BULLET_SPRITES.playerNormal, bullet.x, bullet.y, 10, 30);
    return;
  }

  // Boss patterns all fire square bullets and patrolling enemies fire tall
  // ones, so the orb/capsule choice falls out of existing data.
  if (bullet.width === bullet.height) drawSprite(ctx, BULLET_SPRITES.enemyOrb, bullet.x, bullet.y, 18, 18);
  else drawSprite(ctx, BULLET_SPRITES.enemyCapsule, bullet.x, bullet.y, 12, 26);
}

export function drawPowerUp(ctx: CanvasRenderingContext2D, powerUp: PowerUp): void {
  drawSprite(ctx, POWERUP_SPRITES[powerUp.kind], powerUp.x, powerUp.y, 30, 30);
}

export function drawExplosion(ctx: CanvasRenderingContext2D, explosion: Explosion): void {
  const sheet = EXPLOSION_SHEETS[explosion.kind];
  const box = explosion.kind === "boss" ? 150 : 72;
  drawSprite(ctx, sheetFrame(sheet, explosion.frame), explosion.x, explosion.y, box, box);
}

const METER_WIDTH = 140;
const METER_X = ARENA_WIDTH - METER_WIDTH - 16;

export function drawProgressBar(ctx: CanvasRenderingContext2D, progress: number): void {
  ctx.fillStyle = "#101526";
  ctx.fillRect(METER_X, 16, METER_WIDTH, 10);
  ctx.fillStyle = "#4fd1ff";
  ctx.fillRect(METER_X, 16, METER_WIDTH * progress, 10);
}

/** Fills yellow as energy banks, then flips to a draining cyan bar for the ten
 * seconds of laser it buys — so one strip reads as both charge and timer. */
export function drawEnergyBar(ctx: CanvasRenderingContext2D, energy: number, overdriveMs: number): void {
  const y = 32;
  ctx.fillStyle = "#101526";
  ctx.fillRect(METER_X, y, METER_WIDTH, 8);

  if (overdriveMs > 0) {
    ctx.fillStyle = "#c8faff";
    ctx.fillRect(METER_X, y, METER_WIDTH * (overdriveMs / OVERDRIVE_MS), 8);
    return;
  }
  ctx.fillStyle = energy >= 1 ? "#fff8c8" : "#ffe14f";
  ctx.fillRect(METER_X, y, METER_WIDTH * energy, 8);
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

export function drawEndBanner(ctx: CanvasRenderingContext2D, title: string, lines: string[]): void {
  ctx.fillStyle = "rgba(5, 7, 13, 0.72)";
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f4f6ff";
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.fillText(title, ARENA_WIDTH / 2, ARENA_HEIGHT / 2 - 34);

  ctx.font = "16px system-ui, sans-serif";
  ctx.fillStyle = "#9aa7c7";
  for (const [index, line] of lines.entries()) {
    ctx.fillText(line, ARENA_WIDTH / 2, ARENA_HEIGHT / 2 + 6 + index * 26);
  }
}
