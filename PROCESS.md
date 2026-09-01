# Process overview

## What I built

**Three Rounds** — a browser space shooter. Pick a ship, then take down a
summoner, a berserker and a twin, each with its own bullet logic and its own
trick. Nothing on screen explains it: fire is automatic, and the WASD caps demo
themselves until a real key goes down.
[`a19a854...5a209e1`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-HHHFFF-HHHFFF/compare/a19a854...5a209e1)

## The moments that mattered

### A red check that had never measured anything

`pnpm check` went red on a commit that touched nothing it tests — *throws more
enemy fire late in a run than early*, reading late 5 vs early 6. Re-running
until green was right there. Instead I measured it 40 times (3 failures: it
samples one frame, and killing a boss clears every bullet), then flattened
`difficultyAt` to `return 1` and asked what it said about a ramp that no longer
existed. Green, 40/40. It had never sensed the ramp — late runs are busier
because power-ups accumulate, so bosses come round more often. Split into a
real ramp sensor, verified red when flattened.
[`549e1f0`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-HHHFFF-HHHFFF/commit/549e1f0)

### A screenshot that agreed with me

`scale(calc(100cqw / 480))` divides a length by a number, so the declaration
was invalid and CSS dropped it whole. Nothing scaled, at any window size — and
the screenshots looked fine, because an unscaled 480×800 box looks exactly like
a 480×800 box. Two rounds of pictures agreed with me;
`getComputedStyle().transform` read `none` and settled it in a line.
[`91b27b3`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-HHHFFF-HHHFFF/commit/91b27b3)

### Deleting a check because its premise was gone

Making the game winnable turned two tests red — both assumed a run that never
ends. Shortening their horizons until green was available; instead I deleted
one, because "a late run is busier" no longer describes anything when a run is
ninety seconds. What replaced it tests the spec line the change actually put at
risk: *reach an ending inside five minutes*, which boss health quietly
threatens and no single round would feel wrong about. Each new check was broken
on purpose first — flat health table, telegraph with no delay, clone left out
of the hit test, health ×5. The last looked green until I checked the edit had
applied. It hadn't.
[`361cec4`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-HHHFFF-HHHFFF/commit/361cec4)
