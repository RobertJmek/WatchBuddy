# ADR 0028 — First-run tutorial

**Status:** accepted · targets v1.25.0

## Context

A new account finishes the username + photo step (ADR 0004) and lands in the
Library with no explanation. Most of what WatchBuddy does is behind gestures
that nothing on screen announces: swipe right to log, left to undo, drag to
rate, swipe between tabs, swipe right to go back, pull down to close a title.

## Decision

- **Seven full-screen cards** (icon, title, one or two sentences) with Skip,
  Back and Next. Card 3 is a **"try it" card** holding a real
  `SwipeToLogRow` over a fake title. Swiping it right shows the ✓ and swiping
  it left (or tapping the ✓) undoes it. Local state only, nothing is written.
- **Shown once, right after onboarding.** `onboarding.tsx`'s `finish()` goes
  to `/tutorial` instead of `/`, on both Continue and Skip. Every new account
  passes through onboarding and existing accounts never re-enter it, so
  "new users only" needs **no new storage key**. Killing the app mid-tutorial
  just means the user lands in the app next time.
- **Replay from About** ("How WatchBuddy works", `?replay=1`). In replay,
  finishing goes back instead of replacing the stack with `/`.
- **The cards are a state index inside a `SwipeNav`, not a pager.** The demo
  row has to win against the card swipe. By threshold it does: the row
  activates at 10pt and `SwipeNav` at 12pt, the same rule the Feed segments and
  the title screen rely on. A `PagerView` around a `Swipeable` is the setup
  ADR 0023 warns against, and a paging `ScrollView` claims the drag at 8dp,
  before the row. The route sets `gestureEnabled: false`, so the root
  `StackScreenLayout` adds no second `SwipeNav` around this one.
- **Haptics** go through `haptics.ts`: a tick when Back or Next changes the
  card (a committed swipe already ticks inside `SwipeNav`), success on
  Get started and on a demo log, undo on a demo undo.

## Consequences

- Client only: no migration, edge function or cache-shape change, so installed
  builds are unaffected.
- A user who skips onboarding *and* kills the app before the tutorial never
  sees it unless they replay it. If that matters, add a
  `wb:tutorial-seen:<uid>` key next to onboarding's in `src/lib/onboarding.ts`.
- The copy names features by where they live. Moving one (Stats, the importer)
  means editing `CARDS` in `src/app/tutorial.tsx`.
