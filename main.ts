import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  createEdgePowerUp,
  createEventSquadMember,
  createNormalEnemy,
  randomPowerUpKind,
  SHIPS,
  updateBoss,
  updatePlayerFiring,
  updatePlayerMovement,
} from "./src/entities";
import { stepBulletsAndCollisions, stepEnemyMovement, stepExplosions } from "./src/collision";
import { SHIP_SPRITES } from "./src/assets";
import { installHarness } from "./src/harness";
import * as render from "./src/render";
import { createInput } from "./src/input";
import { resetGame, selectShip, state } from "./src/state";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`index.html is missing ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#arena");
const selectOverlay = requireElement<HTMLDivElement>("#select");
const shipList = requireElement<HTMLDivElement>("#ship-list");

canvas.width = ARENA_WIDTH;
canvas.height = ARENA_HEIGHT;

function requireContext(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = target.getContext("2d");
  if (!context) throw new Error("2d canvas context unavailable");
  return context;
}

const ctx = requireContext(canvas);

installHarness();
const input = createInput();

for (const [index, ship] of SHIPS.entries()) {
  const button = document.createElement("button");
  button.className = "ship-card";
  button.style.setProperty("--ship-color", ship.color);
  const thumb = document.createElement("img");
  thumb.src = SHIP_SPRITES[ship.key].src;
  thumb.alt = "";
  button.appendChild(thumb);
  button.insertAdjacentHTML("beforeend", `<strong>${ship.name}</strong><span>${ship.blurb}</span>`);
  button.addEventListener("click", () => selectShip(index));
  shipList.appendChild(button);
}

let normalSpawnMs = 800;
let eventSpawnMs = 6000;
let edgePowerUpMs = 7000;

function maybeSpawnEnemies(dtMs: number): void {
  if (state.phase !== "playing") return;
  normalSpawnMs -= dtMs;
  if (normalSpawnMs <= 0 && state.enemies.filter((e) => e.kind === "normal").length < 6) {
    normalSpawnMs = 900 + Math.random() * 500;
    state.enemies.push(createNormalEnemy());
  }

  eventSpawnMs -= dtMs;
  if (eventSpawnMs <= 0) {
    eventSpawnMs = 9000 + Math.random() * 6000;
    const startX = Math.random() < 0.5 ? ARENA_WIDTH * 0.3 : ARENA_WIDTH * 0.7;
    for (let i = 0; i < 4; i++) state.enemies.push(createEventSquadMember(i, startX));
  }
}

function maybeDriftPowerUp(dtMs: number): void {
  if (state.phase !== "playing" && state.phase !== "boss") return;
  edgePowerUpMs -= dtMs;
  if (edgePowerUpMs <= 0) {
    edgePowerUpMs = 12000 + Math.random() * 8000;
    state.powerUps.push(createEdgePowerUp(randomPowerUpKind()));
  }
}

canvas.addEventListener("click", () => {
  if (state.phase === "won" || state.phase === "lost") resetGame();
});

let lastTime = performance.now();

function frame(now: number): void {
  const dtMs = Math.min(50, now - lastTime);
  lastTime = now;
  const dtSeconds = dtMs / 1000;

  selectOverlay.hidden = state.phase !== "select";

  if (state.phase === "playing" || state.phase === "boss") {
    const player = state.player;
    if (player) {
      updatePlayerMovement(player, input, dtSeconds);
      updatePlayerFiring(player, dtMs, state.bullets);
    }

    maybeSpawnEnemies(dtMs);
    maybeDriftPowerUp(dtMs);
    stepEnemyMovement(dtSeconds, dtMs);

    if (state.phase === "boss" && state.boss && player) {
      updateBoss(state.boss, dtSeconds, dtMs, state.bullets, player.x, player.y);
    }

    stepBulletsAndCollisions(dtSeconds, dtMs);
  }
  stepExplosions(dtMs);

  render.clear(ctx);
  for (const enemy of state.enemies) render.drawEnemy(ctx, enemy);
  if (state.boss) render.drawBoss(ctx, state.boss);
  for (const bullet of state.bullets) render.drawBullet(ctx, bullet);
  for (const powerUp of state.powerUps) render.drawPowerUp(ctx, powerUp);
  for (const explosion of state.explosions) render.drawExplosion(ctx, explosion);
  if (state.player) {
    render.drawPlayer(ctx, state.player);
    render.drawLives(ctx, state.player.lives, state.player.maxLives);
  }
  if (state.phase === "playing") render.drawProgressBar(ctx, state.progress);
  if (state.phase === "won") render.drawEndBanner(ctx, "Cleared");
  if (state.phase === "lost") render.drawEndBanner(ctx, "Destroyed");

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
