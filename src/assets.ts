// Image registry for the generated art in public/art/. Every entry starts
// loading as soon as this module is imported; nothing here waits for load to
// finish — drawImage on an incomplete HTMLImageElement is a documented no-op,
// not a throw, so the game can start immediately and sprites pop in over the
// first frame or two rather than blocking startup.

function load(name: string): HTMLImageElement {
  const img = new Image();
  img.src = `./art/${name}.png`;
  return img;
}

export const images = {
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

export const SHIP_SPRITES: Record<"interceptor" | "bulwark" | "striker", HTMLImageElement> = {
  interceptor: images.shipInterceptor,
  bulwark: images.shipBulwark,
  striker: images.shipStriker,
};
