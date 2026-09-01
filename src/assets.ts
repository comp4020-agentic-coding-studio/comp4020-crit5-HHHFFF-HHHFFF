// Image registry for the generated art in public/art/. Every entry starts
// loading as soon as this module is imported; nothing here waits for load to
// finish — drawImage on an incomplete HTMLImageElement is a documented no-op,
// not a throw, so the game can start immediately and sprites pop in over the
// first frame or two rather than blocking startup.
//
// The source rectangles below are MEASURED, not guessed: dist/measure.html
// draws each PNG to a canvas, walks getImageData for the alpha bounding box,
// and dumps it for --dump-dom to read. That mattered — the generated art has
// a lot of transparent margin, and drawing whole frames made every sprite
// small and squashed. enemy-normal's ship fills 59% of its frame width, so a
// 40x40 draw of the full frame produced a 24px enemy in a 40px box; the
// player's bullet came out about 2px wide and read as a faint dash.

function load(name: string): HTMLImageElement {
  const img = new Image();
  img.src = `./art/${name}.png`;
  return img;
}

const files = {
  background: load("background-space"),
  shipInterceptor: load("ship-interceptor"),
  shipBulwark: load("ship-bulwark"),
  shipStriker: load("ship-striker"),
  enemyNormal: load("enemy-normal"),
  enemyEvent: load("enemy-event"),
  boss: load("boss"),
  powerupLaser: load("powerup-laser"),
  powerupDiagonal: load("powerup-diagonal"),
  powerupMultiply: load("powerup-multiply"),
  bulletPlayer: load("bullet-player"),
  bulletEnemy: load("bullet-enemy"),
  explosionEnemy: load("explosion-enemy"),
  explosionBoss: load("explosion-boss"),
};

/** The backdrop is drawn whole and stretched, so it needs no source rect. */
export const backgroundImage = files.background;

/** Raw ship images, for the select screen's <img> thumbnails. */
export const SHIP_IMAGES: Record<"interceptor" | "bulwark" | "striker", HTMLImageElement> = {
  interceptor: files.shipInterceptor,
  bulwark: files.shipBulwark,
  striker: files.shipStriker,
};

/** A source rectangle within a loaded image: the sprite's real pixels, with
 * the transparent margin trimmed off. */
export interface Sprite {
  readonly img: HTMLImageElement;
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

function sprite(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number): Sprite {
  return { img, sx, sy, sw, sh };
}

export const SHIP_SPRITES: Record<"interceptor" | "bulwark" | "striker", Sprite> = {
  interceptor: sprite(files.shipInterceptor, 96, 13, 1063, 1219),
  bulwark: sprite(files.shipBulwark, 15, 9, 1224, 1234),
  striker: sprite(files.shipStriker, 70, 22, 1114, 1208),
};

export const ENEMY_SPRITES = {
  normal: sprite(files.enemyNormal, 254, 73, 746, 987),
  event: sprite(files.enemyEvent, 67, 5, 1120, 1241),
  // The summoner's chargers reuse the event ship's art rather than adding a
  // fourteenth 1.4MB PNG for a ship that is on screen for two seconds at a
  // time. render.ts gives them a dive streak, which is what tells them apart.
  charger: sprite(files.enemyEvent, 67, 5, 1120, 1241),
};

export const BOSS_SPRITE = sprite(files.boss, 41, 0, 1175, 1249);

export const POWERUP_SPRITES = {
  laser: sprite(files.powerupLaser, 140, 58, 975, 1108),
  diagonal: sprite(files.powerupDiagonal, 131, 37, 992, 1143),
  multiply: sprite(files.powerupMultiply, 113, 32, 1035, 1186),
};

// bullet-player.png stacks the two forms vertically; bullet-enemy.png puts its
// two side by side. Each was measured on its own half — a union box over both
// left the smaller form swimming in padding.
export const BULLET_SPRITES = {
  playerNormal: sprite(files.bulletPlayer, 452, 20, 120, 546),
  playerLaser: sprite(files.bulletPlayer, 380, 594, 265, 916),
  enemyCapsule: sprite(files.bulletEnemy, 335, 108, 248, 842),
  enemyOrb: sprite(files.bulletEnemy, 731, 311, 459, 467),
};

/** A horizontal strip of equal-width frames sharing one row band. */
export interface SpriteSheet {
  readonly img: HTMLImageElement;
  readonly frameWidth: number;
  readonly sy: number;
  readonly sh: number;
}

// Both sheets are 2172 wide = exactly 6 x 362. The row band is the measured
// alpha extent: the enemy sheet only paints rows 123..563 of its 724, so
// slicing the full height squashed every frame into a tall thin smear.
export const EXPLOSION_SHEETS = {
  enemy: { img: files.explosionEnemy, frameWidth: 362, sy: 123, sh: 441 } satisfies SpriteSheet,
  boss: { img: files.explosionBoss, frameWidth: 362, sy: 80, sh: 503 } satisfies SpriteSheet,
};

export function sheetFrame(sheet: SpriteSheet, frame: number): Sprite {
  return sprite(sheet.img, frame * sheet.frameWidth, sheet.sy, sheet.frameWidth, sheet.sh);
}
