import { ARENA_HEIGHT, ARENA_WIDTH, type ShipDef, SHIPS, shipStats } from "./src/entities";
import { SHIP_IMAGES } from "./src/assets";
import { installHarness } from "./src/harness";
import * as render from "./src/render";
import * as audio from "./src/audio";
import { createInput } from "./src/input";
import { resetGame, selectShip, state } from "./src/state";
import { resetSpawnTimers, stepWorld } from "./src/step";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`index.html is missing ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#arena");
const selectOverlay = requireElement<HTMLDivElement>("#select");
const shipList = requireElement<HTMLDivElement>("#ship-list");
const shipPanel = requireElement<HTMLDivElement>("#ship-panel");
const panelName = requireElement<HTMLParagraphElement>("#panel-name");
const panelBlurb = requireElement<HTMLParagraphElement>("#panel-blurb");
const panelStats = requireElement<HTMLDivElement>("#panel-stats");
const keys = requireElement<HTMLDivElement>("#keys");
const muteButton = requireElement<HTMLButtonElement>("#mute");

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

// ---------- ship select ----------

const shipCards: HTMLButtonElement[] = [];

/** Fills the right-hand panel. Driven by hover/focus, so the stats preview the
 * row you're pointing at; clicking is what commits to it. */
function previewShip(index: number): void {
  const ship: ShipDef = SHIPS[index] ?? SHIPS[0];
  shipPanel.style.setProperty("--ship-color", ship.color);
  panelName.textContent = ship.name;
  panelBlurb.textContent = ship.blurb;

  // Bars are rebuilt rather than mutated, so `transition: width` has nothing
  // to animate from. Setting the real width one frame later gives it a
  // 0 -> value to run, which is what makes the panel visibly re-measure.
  panelStats.replaceChildren();
  const bars: Array<{ node: HTMLDivElement; fill: number }> = [];
  for (const stat of shipStats(ship)) {
    const row = document.createElement("div");
    row.className = "stat";

    const label = document.createElement("span");
    label.className = "stat-label";
    label.textContent = stat.label;

    const track = document.createElement("div");
    track.className = "stat-track";
    const fill = document.createElement("div");
    fill.className = "stat-fill";
    fill.style.width = "0%";
    track.appendChild(fill);

    const value = document.createElement("span");
    value.className = "stat-value";
    value.textContent = stat.value;

    row.append(label, track, value);
    panelStats.appendChild(row);
    bars.push({ node: fill, fill: stat.fill });
  }
  requestAnimationFrame(() => {
    for (const { node, fill } of bars) node.style.width = `${Math.round(fill * 100)}%`;
  });

  for (const [cardIndex, card] of shipCards.entries()) {
    card.setAttribute("aria-current", String(cardIndex === index));
  }
}

function startRun(index: number): void {
  audio.initAudio();
  resetSpawnTimers();
  selectShip(index);
}

function syncMuteButton(): void {
  const muted = audio.isMuted();
  muteButton.setAttribute("aria-pressed", String(muted));
  muteButton.textContent = muted ? "🔇" : "🔊";
}

muteButton.addEventListener("click", () => {
  audio.toggleMute();
  syncMuteButton();
});
syncMuteButton();

for (const [index, ship] of SHIPS.entries()) {
  const button = document.createElement("button");
  button.className = "ship-card";
  button.type = "button";
  button.style.setProperty("--ship-color", ship.color);

  const thumb = document.createElement("img");
  thumb.src = SHIP_IMAGES[ship.key].src;
  thumb.alt = "";
  // Staggered so the three rows don't bob in lockstep.
  thumb.style.animationDelay = `${index * 0.45}s`;

  const text = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = ship.name;
  const tag = document.createElement("em");
  tag.textContent = `${ship.speed} · ${(1000 / ship.fireIntervalMs).toFixed(1)}/s`;
  text.append(name, tag);

  button.append(thumb, text);
  button.addEventListener("mouseenter", () => previewShip(index));
  button.addEventListener("focus", () => previewShip(index));
  button.addEventListener("click", () => startRun(index));

  shipList.appendChild(button);
  shipCards.push(button);
}

previewShip(0);

// The key caps demo themselves in sequence until a real key goes down, then
// hand over to live input for good.
window.addEventListener(
  "keydown",
  () => {
    keys.classList.add("live");
    audio.initAudio();
  },
  { once: true },
);

const KEY_CAPS = [
  { node: requireElement<HTMLElement>('.key[data-dir="up"]'), dir: "up" },
  { node: requireElement<HTMLElement>('.key[data-dir="left"]'), dir: "left" },
  { node: requireElement<HTMLElement>('.key[data-dir="down"]'), dir: "down" },
  { node: requireElement<HTMLElement>('.key[data-dir="right"]'), dir: "right" },
] as const;

function syncKeyCaps(): void {
  for (const { node, dir } of KEY_CAPS) node.classList.toggle("pressed", input[dir]);
}

// ---------- run loop ----------

canvas.addEventListener("click", () => {
  if (state.phase === "lost") {
    resetSpawnTimers();
    resetGame();
  }
});

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `survived ${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

let lastTime = performance.now();

function frame(now: number): void {
  const dtMs = Math.min(50, now - lastTime);
  lastTime = now;

  selectOverlay.hidden = state.phase !== "select";
  if (state.phase === "select") syncKeyCaps();

  stepWorld(dtMs, input);

  for (const event of state.events) {
    if (event.type === "shoot") audio.playShoot();
    else if (event.type === "explosion") audio.playExplosion(event.kind);
    else if (event.type === "hit") audio.playHit();
  }
  state.events = [];

  const thrusting =
    (state.phase === "playing" || state.phase === "boss") && (input.left || input.right || input.up || input.down);
  audio.setEngineIntensity(thrusting ? 1 : 0);

  render.clear(ctx, state.scrollY);
  for (const enemy of state.enemies) render.drawEnemy(ctx, enemy);
  if (state.boss) render.drawBoss(ctx, state.boss);
  for (const bullet of state.bullets) render.drawBullet(ctx, bullet);
  for (const powerUp of state.powerUps) render.drawPowerUp(ctx, powerUp);
  for (const explosion of state.explosions) render.drawExplosion(ctx, explosion);
  if (state.player) {
    render.drawPlayer(ctx, state.player);
    render.drawLives(ctx, state.player.lives, state.player.maxLives);
    render.drawEnergyBar(ctx, state.player.energy, state.player.overdriveMs);
  }
  if (state.phase === "playing") render.drawProgressBar(ctx, state.progress);
  if (state.phase === "lost") {
    render.drawEndBanner(ctx, "Destroyed", [
      formatDuration(state.elapsedMs),
      state.bossesDowned === 1 ? "1 boss downed" : `${state.bossesDowned} bosses downed`,
    ]);
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
