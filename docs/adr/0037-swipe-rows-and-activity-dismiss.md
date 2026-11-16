# ADR 0037 — Swipe rows that work in tabs, and dismissing Activity rows

**Status:** accepted · app only (1.31.0), no backend change · amends ADR 0014

## Context

Swiping a notification away (ADR 0014) had stopped working on iOS: the row did
not move, and letting go counted as a tap on it. Swipe-to-log in Search was
broken the same way. Rows on pushed screens (Seasons, a title) still worked.
Three separate causes, each confirmed on the iPhone simulator:

1. **`display: none` keeps a view out of the native tree on iOS.** The Feed
   kept its hidden segment mounted with `display: none`. RNGH gives a handler
   2.5 s (25 retries) to find its native view and then stops trying, so rows
   first rendered in the hidden Notifications segment never got their swipe.
2. **The tab pager's horizontal scroll took the drag.** RNGH's classic
   `Swipeable` had no way to make the pager wait. Even when attached, the row's
   pan failed and the touch ended as a tap. `SwipeNav` already solves this with
   `blocksExternalGesture(tabPager.native)`.
3. **A poster's hold took the drag in Search** (since the hold menu, ADR 0033).
   A pan with only `activateAfterLongPress` lets UIKit begin it after ~10pt of
   movement, which beat the row; a slow drag could also open the menu.

Separately, Robert asked for the same dismissal on **Activity** rows. ADR 0014
left them out on purpose: a feed row has no id, only a key `feed.ts` builds from
`type:actor:entity:created_at`, which changes when new activity lands.

## Decision

- **One swipe row on the gesture API** (`components/swipe-row.tsx`, a
  `GestureDetector` pan with Reanimated). `SwipeToLogRow` and
  `SwipeToDismissRow` keep their props and become thin wrappers. Inside the tab
  pager the pan blocks the pager's native gesture. While it drags, its wrapper
  takes the React Native responder, because on iOS inside the pager RNGH's
  activation does not cancel the touch the row's `Pressable` is tracking.
- **Hidden Feed segments are transparent and untouchable**
  (`absoluteFill`, `opacity: 0`, `pointerEvents: 'none'`, hidden from screen
  readers), not `display: none`.
- **The hold activates only by a long press** (`minDistance` set out of
  reach), and it does not open its menu while a swipe row is being dragged
  (`setRowDragging`). RNGH's own relations (`requireExternalGestureToFail` /
  `blocksExternalGesture` between the two) were tried and did not hold on iOS.
- **Activity rows can be dismissed, on this device only**
  (`lib/feed-dismissals.ts`, AsyncStorage per account, newest 500 keys).
  Robert's choice over a synced table: no migration, nothing in prod. The same
  Undo strip as notifications; the undo timers moved into
  `hooks/use-pending-undos.ts` and `interleaveUndos` became generic.

## Consequences

- A dismissed Activity row comes back when new activity changes its key (one
  more episode of a binge), the way a notification returns with new activity.
  It does not follow the account to another device, and a reinstall forgets it.
- Every swipe row in the app now runs on this one component: Search, Seasons,
  the title page, Notifications and Activity. The classic `Swipeable` gotchas
  (closing from `onSwipeableOpen`, the subpath crash) no longer apply to them.
- Checked on the iPhone 17 Pro simulator and the Pixel 11 emulator: dismiss
  with Undo on Notifications and Activity, swipe-to-log in Search and Seasons
  (writes stubbed), the hold menu still opening on a still hold. Not checked: a
  physical device, VoiceOver/TalkBack with the new dismiss action, the title
  page's episode rows.
