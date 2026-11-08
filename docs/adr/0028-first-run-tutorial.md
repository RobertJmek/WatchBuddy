# ADR 0028 — First-run tutorial

**Status:** accepted · targets v1.25.0

## Context

A new account finishes the username + photo step (ADR 0004) and lands in the
Library with no explanation. Most of what WatchBuddy does is behind gestures
that nothing on screen announces: swipe right to log, left to undo, drag to
rate, swipe between tabs, swipe right to go back, pull down to close a title.

A first cut showed seven text cards and one demo row that wrote nothing. Robert
rejected it: too much reading, cramped type, and only one card you could act
on. The rule he set is **one real thing to do on every card**.

## Decision

- **Five cards, each a real action** through the app's own components, so the
  account is not empty afterwards:
  1. *Log a watch*: two separate, numbered steps. **Search and tap a result to
     choose it**, then **swipe the chosen title right** on a real
     `SearchRow` (log + undo via `useSearchLog`). They are kept apart so that
     searching is something the user does, not something they scroll past.
     With nothing chosen, a dashed placeholder offers the default title,
     **Fjord** (TMDB 1401459, Robert's pick).
  2. *Rate it*: the real `RatingBar` on the chosen title (or Fjord).
  3. *Your library*: the real `LibraryStatusBar` on the same title.
  4. *Find friends*: a username search with real `UserRow`s (Follow). While
     nothing is typed, it suggests **@watchbuddy**.
  5. *Swipe around*: a miniature tab bar over a paging `ScrollView`.
- **Animated hints show the gesture and step aside once it's done**: the
  swipe row peeks right to uncover its teal "Log" layer; a ghost fingertip
  glides over the rating scale and across the tab demo. They are Reanimated
  CSS animations (UI thread), and they hold still under Reduce Motion.
- **Layout:** an 8pt grid, 12pt inside a group and 32pt between groups. The
  title stays on one line (it shrinks before it wraps). Body text is 17/26, and
  each step's instruction sits right above its control. Copy follows the usual
  UX-writing rules: short, verb first, one term per concept, no marketing voice.
- **The first run is three screens, faded into each other:**
  1. **Welcome** (`/welcome`): a slow wall of this week's posters (the Search
     shelves' `trending` query, so usually a cache hit), then "Welcome to
     WatchBuddy", one line on what it does, and **Get started**. The text sits
     below the wall, never over it.
  2. **Your profile** (`/onboarding`): photo, username, name, and a bio
     (optional), each an unnumbered `Step`. Continue is pinned at the bottom,
     with Skip at the top right.
  3. **The tutorial cards.**

  The first-run gate in `(app)/_layout.tsx` now targets `/welcome`. `Step`
  moved to `src/components/step.tsx`, so the profile step and the cards share
  one look.
- **The keyboard works as it does elsewhere.** Cards and the profile step
  scroll in a `KeyboardAwareScrollView`, the same as sign-in and the title
  page. Next, Back, Skip, finishing and losing focus all dismiss it. On iOS,
  a small chevron button (`KeyboardDismissButton`) rides above the keyboard
  to hide it. iOS keyboards have no hide key and Android's do, so the button
  is iOS only.
- **Shown once, right after onboarding.** `onboarding.tsx`'s `finish()` goes
  to `/tutorial` instead of `/`, on both Continue and Skip. Every new account
  passes through onboarding and existing accounts never re-enter it, so
  "new users only" needs **no new storage key**.
- **Replay from About** ("How WatchBuddy works", `?replay=1`). In replay,
  finishing goes back instead of replacing the stack with `/`.
- **The cards are a state index inside a `SwipeNav`, not a pager.** Every
  control has to beat the card swipe (12pt) by threshold: the swipe row (10pt),
  the rating drag (~6pt) and the demo's native scroll (8dp). A `PagerView`
  around a `Swipeable` is the setup ADR 0023 warns against. The route sets
  `gestureEnabled: false`, so the root `StackScreenLayout` adds no second
  `SwipeNav`.

## Consequences

- Client only: no migration, edge function or cache-shape change, so installed
  builds are unaffected. The writes are the ones the app already makes.
- The rating hint's position assumes `RatingBar`'s layout (the label line, then
  one row of chips). It is commented where it lives, and it needs moving if that
  layout changes.
- The suggested account and the default title are constants at the top of
  `src/app/tutorial.tsx`.
- A user who skips onboarding *and* kills the app before the tutorial never
  sees it unless they replay it. If that matters, add a
  `wb:tutorial-seen:<uid>` key next to onboarding's in `src/lib/onboarding.ts`.
