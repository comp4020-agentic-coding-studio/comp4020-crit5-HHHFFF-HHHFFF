import { describe, expect, it } from "vitest";
import { initAudio, isMuted, midiToFreq, playExplosion, playHit, playShoot, setEngineIntensity, toggleMute } from "../src/audio";

// A sensor, not a contract test: it stays behind CLAUDE.md's explicit
// warning that vitest's JSDOM environment has no Web Audio API at all, and
// `new AudioContext()` throws there. audio.ts is imported by main.ts, which
// no spec file imports directly --- but the moment some future change makes
// any of these calls reach into a real AudioContext instead of no-op'ing
// until initAudio() has run, this suite (which does run under JSDOM) is
// what catches it, rather than a silent break only visible in a real
// browser.
describe("audio", () => {
  it("never touches AudioContext before initAudio(), so it can't throw under JSDOM", () => {
    expect(() => {
      initAudio(); // JSDOM has no AudioContext; this must no-op, not throw
      playShoot();
      playExplosion("enemy");
      playExplosion("boss");
      playHit();
      setEngineIntensity(1);
      toggleMute();
      toggleMute();
      isMuted();
    }).not.toThrow();
  });

  it("converts MIDI note numbers to frequency correctly", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 5); // A4
    expect(midiToFreq(81)).toBeCloseTo(880, 5); // A5, one octave up
    expect(midiToFreq(57)).toBeCloseTo(220, 5); // A3, one octave down
  });
});
