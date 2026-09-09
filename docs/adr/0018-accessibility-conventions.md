# ADR 0018 — Accessibility conventions, and gestures that a screen reader can perform

**Status:** accepted · targets v1.16.1 (no visual change)

## Context

The app contained **exactly zero** `accessibilityLabel`, `accessibilityRole`,
`accessibilityState` or `accessibilityHint` props. Every icon-only control — the
favorite heart, the ⋯ menus, `+`/`−`, the session ✓, the filter funnel, every
✕, the ⓘ — was announced by a screen reader as an unlabelled button or not at
all, and every toggle announced the same thing whether it was on or off.

Three controls were worse than unlabelled: they were **unreachable**. Two swipe
rows and a two-thumb slider are driven by pan gestures, and a screen reader user
cannot perform a pan. Dismissing a notification had no tap equivalent anywhere
in the app, so that feature simply did not exist for them.

Play and the App Store both surface accessibility, and the store listings are
imminent; but the reason to do it is that a whole class of user currently cannot
operate the parts of the app that matter most.

## Decision

Label every interactive element, and give the three gesture-only controls a
non-gesture path. Four conventions, so new code has something to copy:

### 1. Icon-only controls get a label; toggles get a state

`accessibilityRole="button"` plus a label saying what the control *does*.
Anything with two states also carries `accessibilityState={{ selected }}` — a
heart that announces "Favorite" in both states is barely better than silence.
`{ disabled }` and `{ busy }` go on controls that have those, so a reader knows
a Save button is mid-flight rather than broken.

### 2. A label describes the effect, not the icon

The rating scale is the case that forced this rule. A tap on the number you have
already chosen **clears** your rating. Labelling that chip "Rate 7" would have a
screen reader promise the opposite of what the tap does, so it announces
**"Clear rating of 7"** when it is the current value and "Rate 7 out of 10"
otherwise. A wrong label is worse than no label.

The shared `Button` labels itself explicitly rather than relying on its text
child, because while `loading` that child is replaced by a spinner — which
announces as nothing.

### 3. A gesture-only action is also an `accessibilityAction`

| control | the gesture | the action |
|---|---|---|
| `swipe-to-log-row` | swipe right / left | *Log* / *Undo* |
| `swipe-to-dismiss-row` | swipe right | *Dismiss* |

The actions sit on a wrapper `<View>` **inside** the `Swipeable`, not on
`Swipeable` itself. RNGH spreads unknown props onto its gesture handler at
runtime, so passing them straight through appears to work — but `SwipeableProps`
does not type accessibility props, and building an accessibility guarantee on an
untyped runtime spread is the kind of thing that breaks silently on a version
bump. The wrapper is one unstyled `View` in a full-width row, which is
layout-neutral in a column flex context, and it type-checks.

Logging already had a tap equivalent at both call sites (the ✓ in Search, the
`+`/`−` in a season). Dismissing did not, which is why that one is not optional.

### 4. A pan-only slider is an `adjustable`

Each thumb of `range-slider` is `accessibilityRole="adjustable"` with an
`accessibilityValue` (`min`/`max`/`now`, where the *other* thumb is the bound)
and an increment/decrement action that steps by one. Unlike a drag it **commits
immediately** — there is no release to commit on — which also means the haptic
tick fires per step, matching the drag.

## Consequences

- 188 accessibility props where there were none. Most are mechanical; the four
  conventions above are the part that has to survive future code.
- **The wrapper `<View>` inside the two `Swipeable`s is the one layout risk in
  this change**, and it is on a code path (`Swipeable`) that has already shipped
  broken once, in v1.12.0. It must be device-tested on both platforms: rows
  render normally, and the swipe still commits.
- The slider's `step()` is a second write path into the same state as the pan.
  It reads the live values through the same ref the gesture uses, so the two
  cannot disagree, but it is a second path.
- The native tab bar needed no change: `NativeTabs.Trigger.Label` already gives
  each tab an accessible name. Screens are still not announced with headings,
  and dynamic type / large text has not been checked at all — neither is in
  scope here.
