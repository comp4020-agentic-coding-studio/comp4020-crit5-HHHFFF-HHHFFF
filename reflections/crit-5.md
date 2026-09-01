# Crit 5 — Endless Danmaku

## What was the breakthrough that moved the work forward?

Asking a passing check what it would say if I broke the thing it names.

`pnpm check` went red on a commit that had touched nothing it measured, and my
first instinct was to call it noise and re-run. Measuring instead turned
"flaky" into a number — 40 runs, 3 failures, and a cause: it sampled one frame,
and killing a boss clears every bullet on screen. But the useful question came
after that. I flattened the difficulty ramp to a constant and ran the check
against a game that no longer had the thing the check is named for. It stayed
green, 40 out of 40. It had been passing for weeks without ever testing its own
claim. A green suite is only evidence about the checks I have actually tried to
falsify.

## What did this work change about who I want to be as a software developer?

I want to be the kind of developer who distrusts agreement. Twice this week
something looked right and wasn't. The ramp check was one. The other was a
desktop screenshot that appeared to confirm my responsive-scaling fix while the
CSS transform was being silently dropped as invalid — an unscaled 480×800 box
looks exactly like a 480×800 box, so the picture agreed with me and told me
nothing. Both times the answer was to measure the mechanism, not the
appearance: computed style, a repeated experiment.

Working with an agent sharpens this, because it produces plausible work faster
than I can eyeball it. The skill I want is less writing the code and more
deciding what would prove it wrong.
