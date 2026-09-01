# Crit 5 — Three Rounds

## What was the breakthrough that moved the work forward?

The breakthrough was treating a nearly finished feature as more dangerous
than an obviously missing one. The repair-pack work looked coherent: there was
an inventory field, a HUD count, a damage hook and tests. But its transitions
did not match the intended rule. It stored every repair even while hurt, then
spent stored repairs after any hit. Writing a tiny state table exposed the
difference immediately: hurt plus pickup heals; full plus pickup stores; full
plus hit consumes reserve; hurt plus hit loses health.

That table made the remaining work mechanical and testable. I added a focused
check for each boundary, then an integration check that starts a repair in the
far corner and follows the real movement, collision and application path until
health is restored. The lesson extended an earlier breakthrough from this
project: a passing check matters only when it senses the mechanism named on
its label.

## What did this work change about who I want to be as a software developer?

I want to become a developer who reviews behaviour as transitions, not as a
pile of plausible-looking fields and functions. Agent-produced code makes this
especially important because it can be internally consistent while being one
word away from the requested semantics: “always” instead of “only when full.”

I also want verification to cross layers. Unit checks proved the inventory
rules, the integration check proved automatic collection used production
paths, and the rendered frame proved the new count and timers remained legible.
None of those alone was enough. The habit I want is to ask what evidence each
layer can provide, and what it is structurally unable to see.
