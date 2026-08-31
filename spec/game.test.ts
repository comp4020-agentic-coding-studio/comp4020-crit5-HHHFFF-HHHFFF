import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Contract tests for crit 5 ("A game"). They answer this week's published
// spec and retire with it — see spec/README.md.
const DIST = resolve("dist");

function files(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const pages = files()
  .filter((path) => path.endsWith(".html"))
  .map((path) => new JSDOM(readFileSync(path, "utf8")).window.document);

// The brief's no-tutorial rule: no how-to-play modal, no instructions page,
// nothing standing in for either anywhere on screen. This only catches text
// that says so out loud — it can't judge whether the opening screen itself
// makes the first move obvious. That's for the crit, not this file.
const BANNED = /how\s*to\s*play|instructions?|tutorial|click here to start/i;

describe("no on-screen instructions", () => {
  for (const doc of pages) {
    it(`${doc.title || "page"} names no how-to-play text`, () => {
      const text = doc.body.textContent ?? "";
      expect(BANNED.test(text)).toBe(false);
    });
  }
});
