// Canvas draw routines. Every shape is keyed off entity type + size, not
// hand-positioned per asset — swapping placeholder shapes for real sprites
// later is a change to this file only, not to game logic.

import { ARENA_HEIGHT, ARENA_WIDTH, type Boss, type Bullet, type Enemy, type Player, type PowerUp } from "./entities";

const POWERUP_COLORS: Record<PowerUp["kind"], string> = {
  laser: "#ff5f7e",
  diagonal: "#4fd1ff",
  multiply: "#ffe14f",
};

const POWERUP_LABELS: Record<PowerUp["kind"], string> = {
  laser: "L",
  diagonal: "D",
  multiply: "×2",
};

export function clear(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
  ctx.strokeStyle = "#101526";
  ctx.lineWidth = 1;
  for (let y = 0; y < ARENA_HEIGHT; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ARENA_WIDTH, y);
    ctx.stroke();
  }
}

export function drawPlayer(ctx: CanvasRenderingContext2D, player: Player): void {
  ctx.save();
  ctx.globalAlpha = player.invulnerableMs > 0 && Math.floor(player.invulnerableMs / 80) % 2 === 0 ? 0.35 : 1;
  ctx.translate(player.x, player.y);
  ctx.fillStyle = player.ship.color;
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(16, 16);
  ctx.lineTo(0, 8);
  ctx.lineTo(-16, 16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
  ctx.save();
  ctx.translate(enemy.x, enemy.y);
  ctx.fillStyle = enemy.kind === "event" ? "#c86bff" : "#ff8a5f";
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(14, 0);
  ctx.lineTo(0, 14);
  ctx.lineTo(-14, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawBoss(ctx: CanvasRenderingContext2D, boss: Boss): void {
  ctx.save();
  ctx.translate(boss.x, boss.y);
  ctx.fillStyle = "#ff3b6b";
  ctx.beginPath();
  ctx.arc(0, 0, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const barWidth = 200;
  const x = ARENA_WIDTH / 2 - barWidth / 2;
  ctx.fillStyle = "#2a0f16";
  ctx.fillRect(x, 24, barWidth, 10);
  ctx.fillStyle = "#ff3b6b";
  ctx.fillRect(x, 24, barWidth * Math.max(0, boss.hp / boss.maxHp), 10);
}

export function drawBullet(ctx: CanvasRenderingContext2D, bullet: Bullet): void {
  ctx.fillStyle = bullet.owner === "player" ? "#c8faff" : "#ff5f7e";
  ctx.fillRect(bullet.x - bullet.width / 2, bullet.y - bullet.height / 2, bullet.width, bullet.height);
}

export function drawPowerUp(ctx: CanvasRenderingContext2D, powerUp: PowerUp): void {
  ctx.save();
  ctx.translate(powerUp.x, powerUp.y);
  ctx.fillStyle = POWERUP_COLORS[powerUp.kind];
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#05070d";
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(POWERUP_LABELS[powerUp.kind], 0, 1);
  ctx.restore();
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
