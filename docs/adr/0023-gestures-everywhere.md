# ADR 0023 — Gestures everywhere: tab pager, segment swipe, back-swipe, pull-down

**Status:** accepted · targets v1.20.0 · amends [0022](0022-swipe-navigation.md)

## Context

ADR 0022 shipped two narrow gestures: iOS's native swipe-back widened to the
whole screen (a no-op on iOS 26, which already does that), and a swipe from a
24pt strip on the right edge of a title screen to its reviews. Tested on the
phones, that reads as "nothing happens": there is no swipe between tabs, no
swipe between the Feed's segments, nothing on Android — where the 24pt strip is
the system Back zone, so the OS takes the touch before the app sees it — and no
way to close a title or a review thread except the header or the edge.

The direction is now explicit: swipe between the four tabs and between the
Feed's segments; swipe right to go back on every pushed screen, on both
platforms; open a title or a review thread from the bottom and pull it down
to close it, from anywhere on the screen as long as the page is at the top.

The constraint from 0022 still stands — the app **owns horizontal gestures on
most surfaces** (`SwipeToLogRow`, `SwipeToDismissRow`, `RatingBar`, every
`PosterShelf`) and a screen-wide swipe has to lose to all of them. 0022's
answer was area: a strip nothing else starts in. That answer cannot scale to
"anywhere".

## Decision

### Priority by threshold, not by area

`src/components/swipe-nav.tsx` replaces `EdgeSwipeNav`. One `Gesture.Pan` over
the whole screen with optional `onSwipeLeft` / `onSwipeRight` / `onPullDown`
handlers, activating after **20pt** of horizontal travel. Every surface that
owns a horizontal drag activates sooner — `Swipeable` rows at 10, the rating
bar at ~6, a native scroll at 8dp — and react-native-gesture-handler cancels a
handler that is still waiting when another one activates on the same touch.

This is settled in the source, not by hope:

- Android: when a handler activates, `GestureHandlerOrchestrator.makeActive()`
  cancels every other non-simultaneous handler sharing its pointers that is
  still in `BEGAN`; children are delivered first. A native `ScrollView` that
  starts dragging calls `requestDisallowInterceptTouchEvent`, which
  `RNGestureHandlerRootView` answers with `tryCancelAllHandlers()`. Either way
  the waiting screen pan dies. RNGH's root view sees every touch before any
  native child, so the order is fixed.
- iOS: two UIKit recognizers race first-to-begin. With the same thresholds the
  outcome is the same in practice, but it is not deterministic, which is why
  the tab pager exposes a handle (below) and why this is on the device list.

A direction with no handler **fails at 8pt** instead of merely not firing, so
a pan around this one — the tab pager, the stack's back-swipe wrapper — can
take the drag. 0022's two rules survive unchanged: a direction is disabled
outright while it has no target (`.enabled(!!handler)`), and a cancelled pan
(`success === false` in `onEnd`) never navigates.

### Tab pager — option A from 0022, adopted

`NativeTabs` has no swipe primitive, so `src/components/app-tabs.tsx` is now
the headless `Tabs` from `expo-router/ui` with a `react-native-pager-view`
holding the four tab screens side by side, and a JS bar. The cost 0022 named
is paid: SF Symbols, the native badge and iOS 26's glass are gone from the bar.
The reasons to pay it changed — a swipe between tabs was the first thing
asked for, and 0022's tuning worry has the threshold answer above.

Two amendments over the spike:

- `offscreenPageLimit={3}`: every page stays attached. The Library page hosts
  a native `Stack`, and a `ViewPager2` detaching and re-attaching one is not a
  path to discover on a device. It also keeps `NativeTabs`' keep-mounted
  semantics (Feed offsets, Search state).
- A `Gesture.Native()` on the `PagerView`, provided through
  `src/lib/tab-pager.tsx`, so a JS pan inside a tab can declare
  `.blocksExternalGesture(native)` — the one way to give it priority over the
  pager's `UICollectionView` pan on iOS. `setScrollEnabled` rides along as the
  blunt fallback (freeze the pager while a JS pan is active).

### Feed segments — a swipe, not a nested pager

The Feed's `Activity | Notifications` keep ADR 0021's `display: none` toggle;
a `SwipeNav` around the two lists calls the same `setSegment` as the
segmented control. A nested `PagerView` was rejected on source: pager-view's
Android host, when it sits inside another `ViewPager2`, calls
`requestDisallowInterceptTouchEvent(true)` **on every touch-down**, which with
the root-view rule above cancels every RNGH handler inside it — every
`SwipeToDismissRow` would be dead. With the swipe, a notification row's
rightward drag (10) activates before the segment pan (12, under the pager's
16dp slop) and cancels it, so dismissing still works and the segment does not
change under it.

Only the direction that leads somewhere is enabled: Activity swipes left,
Notifications swipes right. The other direction fails early and falls through
to the tab pager — swiping left on Notifications reaches Library, swiping
right on Activity does nothing (Feed is page 0, `overdrag` off).

### Back-swipe on Android — a `screenLayout`, not 17 edits

Android's native stack has no swipe-back, only the OS edge gesture. The root
`Stack` gets a `screenLayout` that wraps every screen in a `SwipeNav` whose
rightward swipe calls `navigation.goBack()`. It is defined only when the
screen can go back, only where the native stack has no gesture of its own —
Android, and the modal routes below on both platforms — and never on a screen
that set `gestureEnabled: false` (onboarding). No interactive animation: the
pop plays the screen's own transition at release.

### Title and review thread — modals, pull-down in JS on both platforms

`title/[id]` and `review/[ratingId]` open with `slide_from_bottom` and close
the same way. Three ways to do the pull-down were on the table:

- **react-native-screens' `gestureDirection: 'vertical'`** — iOS-only
  (`ScreenViewManager.setSwipeDirection` is a no-op on Android), a full-screen
  `UIPanGestureRecognizer` with **no scroll-offset check**, recognizing
  simultaneously with the scroll view's pan. It would dismiss mid-list.
- **`presentation: 'modal'`** — a native iOS sheet that does honour
  scroll-at-top, but iOS-only and a different look.
- **A JS pan on both platforms** — chosen. `SwipeNav`'s `onPullDown` runs
  *alongside* the scroll (`simultaneousWithExternalGesture` with a
  `Gesture.Native()` on the scrollable, from `useSwipeNavScroll()`), records at
  touch-down whether the page was at the top, and fires at release only if it
  was, still is, and travelled 120pt or flicked at 900pt/s. A drag that starts
  mid-list and reaches the top keeps scrolling. Stealing the drag instead would
  need a threshold under the scroll view's own, and then every downward drag
  at the top would stop scrolling.

The two modal routes set `gestureEnabled: false`: react-native-screens drives
one direction per screen, and a sideways drag popping a sheet-style screen
sideways is the wrong picture. The JS rightward swipe from the `screenLayout`
stands in for it on both platforms. `title/[id]/reviews` stays a native push
above the modal (`slide_from_right` + `animationMatchesGesture`, as in 0022).

## Consequences

- Every tab and every pushed screen has a swipe on both platforms; a title
  and a review thread have two ways out by gesture (right, down) plus the
  header.
- `react-native-pager-view` is a new native dependency on `main`: a dev-client
  rebuild before any device test, `npm ci` before a release build.
- The tab bar is JS. Anything the native bar gave for free (glass, SF Symbols,
  the native badge, iOS 26's tab-bar scroll behaviours) is gone until
  `NativeTabs` grows a pager or the bar is rebuilt.
- Four native pages are attached at launch instead of one visible tab. The JS
  side already mounted all four under `NativeTabs`; the native cost is untested.
- The collision story is now a threshold table. Any new horizontal control
  must activate under 20pt (12 inside a tab) or it will lose to the screen
  swipe; anything that changes `Swipeable`'s `dragOffsetFromLeftEdge` or a
  pan's `activeOffsetX` changes the outcome and is a device pass.
- What only a device can settle, in order of damage if wrong: iOS rows vs the
  pager (fallback: `blocksHandlers` on the two `Swipeable`s, from
  `useTabPager()`); iOS segment pan vs the pager (fallback: `setScrollEnabled`
  lock around the pan); pull-down feel on both (fallback: `bounces={false}`
  on the two scrollables); the Library stack inside a pager page.
- `SwipeNav` is gesture-only, like `EdgeSwipeNav` was, and needs no
  accessibility equivalent: every swipe here duplicates a control that exists
  (tab buttons, the segmented control, headers, "See all reviews").
- No SQL, no edge-function change.

## Amendment — v1.20.1: what Android showed

Robert's Android phone reported two things: a title screen that **would not
scroll**, and swipes that **did not start**. Both reproduced on an Android
emulator running the released v1.20.0 APK (driven by `adb shell input swipe`,
which delivers real `MotionEvent`s), and four separate causes came out of it.

1. **The pull-down pan froze the title's scroll.** The `Gesture.Native()` that
   was meant to be the scroll view's handler was attached to
   `KeyboardAwareScrollView`'s outermost host view. In its default
   `mode="insets"` that is a `ClippingScrollViewDecoratorView` (a
   `ReactViewGroup`) *wrapping* the ScrollView
   (`react-native-keyboard-controller/src/components/ScrollViewWithBottomPadding`).
   The pan was therefore simultaneous with the wrapper, not the scroll; once it
   activated, the RNGH root intercepted and the real ScrollView was cancelled.
   The review thread's plain `FlatList` did not have the wrapper, which is why
   only titles froze.
   **Decision (Robert's call): pull-down is no longer a pan.** On iOS it is the
   scroll view's own rubber-band overscroll, read in `onScrollEndDrag`
   (`src/lib/pull-to-dismiss.ts`, 80pt past the top). On Android there is none,
   and the two modal routes close with back or the right-swipe. No gesture
   handler sits over either scroll view any more.
2. **The Feed's segment swipe worked once.** `SwipeNav` set a `busy` flag on
   fire and cleared it on focus. That guards a push or a pop, but a segment
   switch never changes focus, so the second segment swipe was ignored until
   you left the tab. The guard is now `navigation.isFocused()` at fire time: a
   push or pop drops focus immediately, a segment switch does not.
3. **Two nested `SwipeNav`s: the outer one never fires.** The title screen has
   its own (left → reviews) inside the root layout's back-swipe wrapper. The
   inner one fails a rightward drag at 8pt as designed, and on Android the
   outer one still never activated, so the title had no back-swipe. The title's
   `SwipeNav` now owns both directions. Rule: a screen that adds a `SwipeNav`
   gives it `onSwipeRight` too.
4. **20pt was too far on Android.** A vertical `ReactScrollView` intercepts at
   8dp of *vertical* travel, so a swipe had to stay within ~22° of horizontal
   to reach 20pt first. The activation distance is now **12pt** everywhere,
   still above `Swipeable` rows (10) and the rating bar (~6), and still under
   the pager's 16dp slop. That widens the usable swipe to ~34°. The threshold
   table in *Priority by threshold* above now reads 12, not 20.

The device list shrinks accordingly: "pull-down feel on both" becomes "iOS
overscroll-to-close on the title and the thread". Two things were confirmed on
the emulator: the rating bar keeps a drag that starts on it, and a poster shelf
keeps a drag that starts on it, both ahead of the screen swipe.
