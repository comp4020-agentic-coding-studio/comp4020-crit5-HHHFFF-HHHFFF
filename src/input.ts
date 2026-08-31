import type { InputState } from "./entities";

const KEYS: Record<string, keyof InputState> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  a: "left",
  d: "right",
  w: "up",
  s: "down",
};

export function createInput(): InputState {
  const input: InputState = { left: false, right: false, up: false, down: false };

  window.addEventListener("keydown", (event) => {
    const key = KEYS[event.key];
    if (key) input[key] = true;
  });
  window.addEventListener("keyup", (event) => {
    const key = KEYS[event.key];
    if (key) input[key] = false;
  });

  return input;
}
