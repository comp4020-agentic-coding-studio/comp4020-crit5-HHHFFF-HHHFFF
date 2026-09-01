# Process overview

## What I built

**Endless Danmaku** — a browser space shooter. Pick one of three ships and hold
out while waves, boss rounds and bullet patterns thicken on a ramp derived from
elapsed time, so standing still gets harder on its own. Nothing on screen
explains it: fire is automatic, and the WASD caps demo themselves until a real
key goes down.
[`a19a854...5a209e1`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-HHHFFF-HHHFFF/compare/a19a854...5a209e1)

## The moments that mattered

### A red check that had never measured anything

`pnpm check` went red on a commit that touched nothing it tests — *throws more
enemy fire late in a run than early*, reading late 5 vs early 6. Re-running
until green was right there. Instead I measured it 40 times — 3 failures, ~7%,
because it samples one frame and killing a boss clears every bullet — then
flattened `difficultyAt` to `return 1` and asked what it said about a ramp that
no longer existed. Green, 40/40. It had never sensed the ramp: a late run is
busier because power-ups accumulate, so kills come faster and bosses come round
more often. Split into a sensor that goes red when the ramp is flattened,
verified, and a smoke check with the ramp claim taken off it.
[`549e1f0`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-HHHFFF-HHHFFF/commit/549e1f0)

### A screenshot that agreed with me

`scale(calc(100cqw / 480))` divides a length by a number, so the declaration
was invalid and dropped whole. Nothing scaled, at any window size — and the
desktop screenshots looked fine, because an unscaled 480×800 box looks exactly
like a 480×800 box. `getComputedStyle().transform` read `none` and settled it.
Phone width needed an iframe: Chrome clamps its window to 500px on Windows and
crops the PNG, which reads as overflow that isn't there.
[`91b27b3`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-HHHFFF-HHHFFF/commit/91b27b3)

### Sound without letting audio into the simulation

`state.ts` pushes plain events; `main.ts` turns them into oscillators.
`spec/audio.test.ts` is the sensor — it calls every audio export under JSDOM,
where `new AudioContext()` would throw.
[`c7184de`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-HHHFFF-HHHFFF/commit/c7184de)
