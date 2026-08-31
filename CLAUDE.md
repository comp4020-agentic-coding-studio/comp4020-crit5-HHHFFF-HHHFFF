# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Run `pnpm check` before you push.
- Open the page in a browser and look at it. The rendered page is the truth;
  your mental model of it isn't.
- When a check fails, read its output before you change anything.
- Never commit a red state.
- Never reshape production code to satisfy a test environment: no downgrading
  module scripts, no inline scripts added for JSDOM's benefit, no second copy
  of core logic just for tests. If a test needs to drive an interactive state,
  add a small seam on `window` that steps the same instance the visitor is
  watching (e.g. `window.harness.doThing()`), not a parallel implementation.
- If you write your own check, prove it would have failed on the commit before
  the bug it targets --- a check that has never been red isn't a check.

## Seeing the rendered page on this machine

There's no `agent-browser` CLI installed here, so ground truth comes from
headless Chrome directly:

```bash
pnpm build && npx vite preview --port 4173 --strictPort &   # serve dist over http
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu \
  --hide-scrollbars --window-size=1920,1080 --virtual-time-budget=6000 \
  --screenshot="C:\Users\H-F\AppData\Local\Temp\shot.png" \
  "http://localhost:4173/"
```

Three things to know. **Write the PNG to the temp dir, not the repo** ---
Chrome gets "拒绝访问" writing into the working directory. **Serve over http,
not `file://`** --- a module script (`<script type="module">`) won't run from
a `file://` origin (CORS, origin `null`), so a `file://` screenshot silently
shows the page with no JavaScript at all. And to see an interactive state,
write a copy of `dist/index.html` back **into `dist/`** (same origin, relative
asset URLs resolve) with a module script appended that drives the page via a
`window`-level test seam; module scripts run in order, so injected code lands
after the page's own script has wired up. Delete the copies afterwards ---
`vite build` empties `dist/` first, so anything left over 404s on its own
now-deleted assets and reads as a broken page.

### Chrome won't give you a 390px window --- use an iframe

`--window-size=390,844` **does not produce a 390px viewport** on Windows.
Chrome clamps the window to a 500px minimum, then writes a PNG that is 390
wide anyway --- so the image is the left 390px of a 500px layout, cropped.
That reads exactly like horizontal overflow and isn't. If a deliverable marks
a phone-width viewport, measure it by rendering the page inside a narrow
iframe instead of resizing the window, and read `clientWidth` / `scrollWidth`
/ `getBoundingClientRect()` from the parent, dumped into the DOM for
`--dump-dom` to pick up. Pass `--hide-scrollbars` on the measuring run too, or
the iframe's own scrollbar eats into it and `clientWidth` reads short.

### Headless Chrome barely runs `requestAnimationFrame`

`--virtual-time-budget` advances virtual time, but with no compositor
headless produces roughly a frame per second of it --- anything driven by rAF
is invisible to a screenshot or `--dump-dom` check, which reads as "broken"
when it's fine. The fix is a test seam: expose a hook on `window` that steps
the same state the visitor sees, without waiting for frames, and drive it
from the injected script.

### Don't trust JSDOM for anything about rendering, timing or audio

It doesn't model the user-agent/author cascade (`getComputedStyle` can report
`display: none` for something plainly visible in Chrome). It does not execute
`<script type="module">` (Vite's build emits exactly one). It has no
`requestAnimationFrame`, `canvas.getContext("2d")` returns `null`, and **it
has no Web Audio API at all** --- `new AudioContext()` throws under JSDOM, so
anything that touches audio or canvas has to live in a DOM-free module and be
tested there directly, with JSDOM limited to asserting the markup contract and
real Chrome checked for what actually renders (and sounds).

### `hidden` loses to any author `display`

The `hidden` attribute is only `[hidden] { display: none }` in the user-agent
stylesheet, and author rules beat the user agent at any specificity. So
`.thing { display: flex }` plus `<div class="thing" hidden>` renders visible
--- the attribute reads correctly in the DOM and in every markup assertion
while the element sits there on screen. Any element that sets its own
`display` and gets toggled by `hidden` needs the override alongside it:

```css
.thing { display: flex; }
.thing[hidden] { display: none; }
```

And `hidden` is still the wrong tool whenever the box has to keep its space.
It is `display: none`, so toggling it collapses the element and everything
below it moves. To swap one line of text for another in place, stack both in
one CSS grid cell and hide the inactive one with `visibility` plus
`aria-hidden`; the container then stays as tall as the taller line and nothing
reflows.

### A state that is fine and a state that is fine can still hide a bug

A past prototype's opening prompt swapped to a longer line on the first
interaction and pushed the whole layout 25px down the page. Both states were
correct on their own. Only the transition was wrong, and nothing that checked
one state at a time could see a transition at all.

So when a page has states, assert across the change, not just within each
one: drive the state change through the `window` seam and compare the layout
before against the layout after. If this week's prototype needs a render
check, this is the shape it should take.

### Measuring layout: sum `offset*`, and skip transformed subtrees

Two traps, both of which produced convincing false positives before the real
bug showed up:

- `getBoundingClientRect()` includes CSS transforms, so an element that merely
  animates looks like it moved. `offsetTop`/`offsetLeft`/`offsetWidth`/
  `offsetHeight` ignore transforms --- use those.
- But a transform also makes an element a **containing block**, so lighting a
  transformed element re-parents its descendants' `offsetParent` and every raw
  `offsetTop` underneath changes meaning mid-measurement. That read as a 506px
  jump and was nothing at all. Sum `offsetTop`/`offsetLeft` up the
  `offsetParent` chain to get document coordinates, and drop elements with a
  transformed ancestor from the comparison --- they are being animated, not
  laid out. Don't paper over it with a pixel tolerance; a real 2px reflow
  should still fail.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; `index.html`'s
head points at it. Replace it and the `description` meta, and copy the head
block into any new page. The card URL resolves against the page that names it,
like any link --- `./card.png` is wrong one directory down, and nothing in CI
checks it, so look at the deployed head when you add pages.

## The checks

`pnpm check` runs them (`pnpm check:evidence` is the extra gate before you
ship); CI runs the same plus links, secrets and the deploy. Read the failure.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## This file is yours

A starting point, not a rulebook: what you add to it is the harness, and the
harness is assessed. This file and the sensors you wire into `check` carry
across the course --- both come with you into next week's repo. The prototype
doesn't: source, and the tests answering this week's published spec, stay
behind. `spec/README.md` draws the line.
