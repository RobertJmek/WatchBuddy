# ADR 0022 — Swipe between screens: full-screen back, edge-swipe to a sibling

**Status:** accepted · targets v1.19.0 · amended by [0023](0023-gestures-everywhere.md) (v1.20.0: the tab pager is adopted, the edge strip is replaced by a full-width swipe, and the title/review screens become modals with a pull-down)

## Context

Every navigation in WatchBuddy was a tap. The four tabs are a `NativeTabs`
bar, pushed routes live on a root native `Stack` with headers hidden and no
gesture options set, and the Feed's Activity | Notifications segments are a
`display: none` toggle (ADR 0021 rejected a pager for them). On iOS that left
the interactive pop as the **only** back affordance on a pushed screen — and it
was the stock left-edge one, which on a phone held in one hand is a reach.

The ask was to explore swiping between screens. Three options were spiked on
their own branches and judged on a device:

- **B — full-width swipe-back** on pushed screens.
- **C — edge-swipe to a sibling screen**, a swipe *shortcut* to a push.
- **A — swipe between the four tabs**, which means replacing `NativeTabs`
  with the headless `Tabs` from `expo-router/ui` plus `react-native-pager-view`.

The constraint that shaped all three is that the app already **owns
horizontal gestures on most surfaces**: `SwipeToLogRow` (Search results, a
season's episodes, both directions), `SwipeToDismissRow` (notifications), the
`RatingBar` drag-to-rate, the filter sheet's `RangeSlider`, and every
`PosterShelf`. Any screen-wide horizontal swipe has to lose to all of them,
reliably, on both platforms.

## Decision

### B — widen the back gesture to the whole screen (one option)

`fullScreenGestureEnabled: true` on the root `Stack`'s `screenOptions`. It is
react-native-screens' own option, so the transition stays native — nothing is
rebuilt in JS. Since headers are hidden everywhere, this is the largest UX gain
for the smallest diff.

Two facts that bound its effect:

- **iOS 26 already defaults to `true`.** The option makes iOS 18 and below
  match; on a current iPhone it changes nothing.
- **Android is untouched.** The OS back gesture already works;
  `predictiveBackGestureEnabled: false` in `app.json` only drops the predictive
  *preview* animation and stays as it was.

Screens that own a horizontal pan mid-screen — drag-to-rate on a title,
swipe-to-log on a season — were the collision checks. Per-screen
`fullScreenGestureEnabled: false` is the opt-out if one ever needs it; none
did on the device pass.

### C — `EdgeSwipeNav`, a right-edge swipe that pushes the sibling

`src/components/edge-swipe-nav.tsx`: one `Gesture.Pan` whose hit area is a
**24pt strip on the right edge** (`hitSlop` with `width` + `right`), activating
on 20pt of leftward travel, failing on 14pt of vertical travel, and firing
`onSwipe` **once at release** when the drag committed (60pt, or a 600pt/s
flick). The caller does the `router.push`; the sibling gets
`animation: 'slide_from_right'` + `animationMatchesGesture`, so the screen
slides in like the next page and the back swipe slides it out the same way.
It is a swipe shortcut to the native transition, not a JS pager.

Why the right edge, and only the right edge:

- The left edge is the iOS back gesture — the whole screen, after B.
  Leftward from the right edge is the one direction nothing else claims.
- A gesture that must *begin* in the strip can never be seen by a row swipe,
  a rating drag or a poster shelf, so no `simultaneousHandlers` tuning and no
  per-surface exceptions.
- The detector **wraps** the screen rather than overlaying it, so a vertical
  drag that starts in the strip fails the pan and the scroll view keeps it.

Two rules that came out of review, both now in the component:

- **Disabled until there is a target.** `onSwipe` is optional and the pan is
  `.enabled(!!onSwipe)`. The title screen passes the handler only once the
  title is known. The first cut set a `busy` flag before calling a handler
  that returned without navigating, and the flag only clears on the next
  focus — so a swipe on a still-loading title killed the gesture on that
  screen until you left and came back.
- **A cancelled pan does not navigate.** `onEnd` bails on `success === false`:
  when the native swipe-back or the scroll view takes the touch, the pan's
  translation may already be past the threshold and must not count.

Wired on one pair for now: **title → its reviews**. The reviews screen has an
empty state, so the swipe is available on a title with no reviews too — a
gesture that sometimes works is worse than one that opens an empty list.

### A — tab pager: spiked, not adopted

Built on `spike/swipe-tabs` and cold-launched on a simulator (no crash, the
JS bar and pager follow navigation), but **not merged**. It costs the native
bar — SF Symbols, the native badge, iOS 26's glass — and a new native
dependency, and every tab body owns the horizontal gestures listed above, so
"row swipe beats page swipe" would have to be tuned per surface and re-proven
on every gesture change. That is the trade ADR 0021 already declined for two
lists; for four tabs it is larger. The branch stays as the reference if the
question is reopened.

## Consequences

- Every pushed screen on iOS ≤18 can now be swiped back from anywhere; on iOS
  26 the behaviour is unchanged and now explicit.
- One pair of siblings has a swipe between them. Adding another (`user/[id]`
  ↔ followers, Feed Activity → Notifications) is a wrap plus two `Stack.Screen`
  options — but each new pair is a new device pass, because the strip's
  collision story is "nothing else starts there", and that has to hold on the
  screen in question.
- `EdgeSwipeNav` is the fourth gesture-only control in the app. Unlike the
  three in ADR 0018 it needs no accessibility equivalent: the "See all
  reviews" link is the non-gesture path and stays.
- No SQL, no edge-function change, no new dependency on `main`.
