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

**The actions belong on the row's own focusable element — not on the swipe
component.** VoiceOver and TalkBack expose the custom actions of the element
that has **focus**, and that is the row itself (a `Pressable` or `PressScale`
with a button role). A wrapper inside `Swipeable` is not `accessible`, so it is
never a focus target and its actions are never reachable: the first attempt at
this shipped exactly that and the action menu would have been empty. Making the
wrapper `accessible` is the wrong repair — it collapses the whole row into one
node and swallows the ✓ button and the avatar with it.

So `SwipeToLogRow` / `SwipeToDismissRow` carry no accessibility props at all;
each call site spreads `accessibilityActions` + `onAccessibilityAction` onto its
own row, and both components document that contract in their doc comment. The
label a swipe reveals and the label its action offers come from one helper
(`logLabel()` in `explore.tsx`) so they cannot drift apart.

Which of these are load-bearing differs by screen, and it is worth being precise:
in a season **both** directions already have buttons (the ✓ and the `−`), so the
actions there are consistency. In Search, undo has the ✓ but **logging has no tap
equivalent at all**. And dismissing a notification has none anywhere. Those last
two are the only paths that exist.

### 4. A pan-only slider is an `adjustable`

Each thumb of `range-slider` is `accessibilityRole="adjustable"` with an
`accessibilityValue` (`min`/`max`/`now`, where the *other* thumb is the bound)
and an increment/decrement action that steps by one. Unlike a drag it **commits
immediately** — there is no release to commit on — which also means the haptic
tick fires per step, matching the drag.

The role is not enough on its own: **Android's `ReactAccessibilityDelegate`
dispatches only the actions a view actually declares**, so a thumb must list
`increment`/`decrement` in `accessibilityActions` or TalkBack's volume-style
swipe reaches nothing. iOS works without the declaration, which is precisely why
this is easy to ship broken.

## Consequences

- 188 accessibility props where there were none. Most are mechanical; the four
  conventions above are the part that has to survive future code.
- **The contract is easy to forget.** Because the swipe components deliberately
  hold no accessibility props, a new call site that omits the actions loses the
  accessible path with nothing failing — not `tsc`, not lint, not `expo export`.
  The doc comment on each component is the only guard, which is why both say so
  at length rather than in passing.
- `NotificationRow` gains an `onDismiss` prop that duplicates what its
  `SwipeToDismissRow` parent already receives. That redundancy is the price of
  putting the action on the focusable node.
- Both defects here were found in review, not by any tool, and neither would
  have been visible without a screen reader running. **A device pass with
  TalkBack and VoiceOver is the only real verification** of anything in this ADR.
- The slider's `step()` is a second write path into the same state as the pan.
  It reads the live values through the same ref the gesture uses, so the two
  cannot disagree, but it is a second path.
- The native tab bar needed no change: `NativeTabs.Trigger.Label` already gives
  each tab an accessible name. Screens are still not announced with headings,
  and dynamic type / large text has not been checked at all — neither is in
  scope here.
