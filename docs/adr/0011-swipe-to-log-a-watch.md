# ADR 0011 — Swipe-to-log a watch (Search) with session-scoped undo

**Status:** accepted · 2026-07-25

## Context

Logging a watch meant tapping a button: `＋ Log watch` (movie), `＋ Log whole
series` (`TvWatchBar`), or per-episode `+/−` (season screen). We want a faster,
gesture-driven path straight from **Search** — swipe-right to log, swipe-left to
undo — and the same gesture on individual **season** episode rows.

This is the **first gesture in the app**: there was no `GestureHandlerRootView`,
`Swipeable`, or `GestureDetector` anywhere. Two facts about the data model shaped
the design:

- A **series isn't a single watchable unit** — logging it means one
  `episode_watch` per non-Specials episode (hundreds of rows), fetched season by
  season. Binding that to a light, quasi-accidental swipe is disproportionate.
- Episode inserts are **additive** (every log is a fresh row, so rewatches
  accumulate). "Undo the series I just logged" therefore cannot be "delete all
  episode_watches for this title" — that would nuke pre-existing/legitimate
  watches.

## Decision

- **Auto-commit swipe, no tap-buttons.** `SwipeToLogRow`
  (`src/components/swipe-to-log-row.tsx`, wrapping the classic `Swipeable` from
  the **main** `react-native-gesture-handler` entry) fires once past a drag
  threshold and snaps back, revealing a colored icon+label underneath.
  `GestureHandlerRootView` is mounted at the app root (`_layout.tsx`). We use the
  main-entry `Swipeable`, **not** the `…/ReanimatedSwipeable` subpath — see the
  crash note in Consequences.
- **A series needs a long swipe.** Movie/episode commit at ~22% of row width; a
  series (the heavy action) at ~45%. The longer, deliberate swipe *is* the
  confirmation — no modal. (Tuned on-device from an initial 28%/60% + friction 2,
  which made the series swipe unreachable — see On-device tuning below.)
- **Undo = session-scoped, exact-rows.** A swipe-right records the precise ids it
  inserted (1 movie / N episodes) in in-memory Search state; undo deletes exactly
  those (`removeMovieWatch` / new `removeEpisodeWatchesByIds`). Undo is a no-op
  for a row you didn't swipe-log this session.
- **Movie undo restores Library status.** `logMovieWatch` also forces the title
  to `completed` (overwriting the prior status). The swipe reads the pre-log
  `library_items.status` first and restores it on undo (or `removeFromLibrary`
  if there was none) — a true reverse.
- **Feedback is an optimistic session checkmark, not a history badge.** A
  swipe-right shows the teal ✓ **instantly** (meaning "I just logged this from
  here") while the DB write runs in the background — dimmed until it lands, and
  an undo tapped during that window cancels the write (which then rolls itself
  back, so no orphan rows); on write failure the ✓ is removed. Tapping the ✓
  undoes. It is **not** a "watched-ever" mark — that would need a per-result query
  on a live search list and is incoherent for a series (is a show "watched" if you
  saw some episodes?).
- **The season screen keeps its `+/−` buttons and adds swipe as a mirror.** There
  the row is already stateful, so swipe reuses the existing persistent
  `addWatch` / `removeWatch` (remove-most-recent) — session-scoped undo is a
  **Search-only** concept.

## Consequences

- **Data-layer additions are minimal:** `logMovieWatch` and
  `logManyEpisodeWatches` now return the inserted id(s), and
  `removeEpisodeWatchesByIds` is new. Everything else (title resolution via
  `getTitle`, `fetchAllEpisodes`, the log/remove calls) is reused as-is.
- **Logging a series from Search is slow** (fetch all seasons + a large insert),
  but the optimistic ✓ hides that latency — it shows immediately (dimmed) and
  solidifies once the write lands.
- **The checkmark is ephemeral.** Leaving Search forgets it, though the watches
  persist in Diary/Stats. This is deliberate — it tracks the *gesture*, not
  watch history.
- **`expo-haptics`** was added for a light impact on commit → the shipped build
  must be rebuilt (native module). The rest of the feature is pure JS.
- **Haptics later moved out of the swipe row** (see the follow-up below).
- **On-device tuning was needed.** Thresholds are window-width fractions and the
  emulator misreports gestures, so the feel was validated on-device: the series
  swipe was initially *impossible* (threshold 60% + `friction: 2` doubling finger
  travel + `overshoot` off capping the drag). Fix: `friction` 1 (1:1 tracking),
  overshoot on (drag not capped), thresholds 45%/22%.
- **Startup-crash gotcha (fixed in v1.12.1).** v1.12.0 first shipped importing
  `ReanimatedSwipeable` from the `react-native-gesture-handler/ReanimatedSwipeable`
  subpath. That loaded a **second copy** of the `RNGestureHandlerButton` native
  component into the bundle (the main entry, already loaded by react-navigation,
  registers it too) → `Tried to register two views with the same name
  RNGestureHandlerButton` at launch. `expo export` builds fine (runtime, not
  bundle error); only an on-device run catches it. Fix: import `Swipeable` from
  the **main** entry only, so RNGH is loaded once. **Never mix the RNGH subpath
  imports with the main entry.**

## Follow-up: haptics app-wide (v1.12.2)

The swipe row was the app's only haptic call site, and it called `expo-haptics`
directly. Two problems, both fixed by moving to a shared **`src/lib/haptics.ts`**:

- `Haptics.impactAsync(...)` **throws synchronously** when the native module is
  missing (a dev client older than the prebuild that added it). The old
  `.catch(() => {})` only handled a rejected promise, so that throw would have
  propagated out of `handleWillOpen` and swallowed the `onLog()` call — a swipe
  that logs nothing. Every helper in `haptics.ts` is fire-and-forget and cannot
  throw.
- Android's `ImpactFeedbackStyle.Light` is close to imperceptible. The helpers
  use SDK 56's semantic `performAndroidHapticsAsync` effects (`Confirm`,
  `Reject`, `Toggle_On/Off`, `Segment_Tick`) on Android and the UIKit generators
  on iOS.

`SwipeToLogRow` itself **no longer fires haptics**: every caller wires the same
handler to a tap-button as well, so buzzing in the swipe wrapper double-fired.
The handler owns the haptic — it also knows whether the action is a tick or a
full commit. Haptics now cover every data-changing action (watch log/undo,
episode +/−, library status, favorite, follow, rating, like, review save), fired
at the optimistic moment with `hapticFailure()` on the rollback path. Navigation
and plain taps stay silent by design.

**Drag-to-rate** rides on the same helpers: the 1–10 scale in `rating-bar.tsx` is
now a `Gesture.Pan` surface — drag across it and the number under your finger pops
(spring scale + lift) with a bubble above the row, one `hapticTick()` per step
crossed and a `hapticSuccess()` on release. Three things make it behave:

- The row became **ten equal `flex: 1` cells** (was `flexWrap: 'wrap'` with fixed
  30px circles, which needed 336px and wrapped to two rows on a narrow phone).
  Equal cells are what make `floor(x / (rowWidth / 10))` land on the number you
  actually see.
- `activeOffsetX([-6, 6])` + `failOffsetY([-14, 14])`, because the title screen is
  a vertical `ScrollView`: a drag that starts on the scale but goes up or down has
  to scroll the page, not pick a rating.
- **A drag never clears.** Tapping your current rating still clears it; releasing a
  drag on it is a no-op. Stopping your finger on the number you already have is far
  too easy to do by accident to spend a rating on.

The scale also **fills live** while you drag — the circles and the selected ring
follow `hovered ?? value`, so the bar fills and empties under your finger and the
release just keeps what you already see.

## Follow-up (v1.23.0): season rows on the title screen

A series' title screen lists its seasons, and each row is now a `SwipeToLogRow`
too. Swipe right logs the season, swipe left undoes it, and the ✓ that shows up
can also be tapped to undo.

- **A season swipe adds one watch to every aired episode in it.** It doesn't
  skip the episodes you've already seen, so on a season you've watched it is a
  rewatch. That matches the season screen's "Log whole season" button (Robert's
  call). "Log whole series" follows the same rule: +1 on every aired episode,
  every press, with no confirmation, and it then marks the series Completed.
  Under the button, "Logged N times · Undo" counts this visit's presses, and
  Undo pops the latest one (its rows and its status change), on the same
  session stack as the season rows. (From v1.22.1 to v1.23.5 it filled in only
  the unlogged episodes behind a confirmation; Robert reverted that in
  v1.23.6.) A Search swipe on a series marks it Completed too, and its undo
  restores the earlier status, as it already did for a movie.
- **The swipe can be repeated, like the episode rows.** Each long swipe adds
  another watch, and the ✓ shows how many (×2, ×3). **Undo is a stack per
  session**: each swipe left (or tap on the ✓) reverses the most recent swipe
  from this visit and removes exactly the rows it inserted. So three swipes
  right and three left bring you back to where you started. Watches logged
  any other way are never touched. On a season you didn't swipe-log on this
  visit, undo does nothing. Search keeps one log per row. The cancel-token and
  rollback machinery used to live inside the Search hook. It is now
  `useSessionLog` (`src/lib/use-session-log.ts`), and Search and the title
  screen both use it, so the race fixes live in one place.
- **It needs the long swipe** (`longLog`, 45% of the width), just like a whole
  series. A season is tens of rows written with no dialog, so the length of the
  swipe acts as the confirmation.
- **The row takes priority over the screen's swipe.** The title screen's
  `SwipeNav` (left opens Reviews, right closes) activates at 12pt, while the
  row's `Swipeable` activates at 10pt. So a horizontal drag that starts on a
  season row belongs to the row, on both platforms (ADR 0023's
  threshold rule). That is the same trade the season screen's episode rows
  and Search's rows already make. You close the page or open Reviews by
  dragging anywhere else on it. Android's system back gesture starts at the
  screen edge and the OS takes it before the app does.

## Follow-up: haptics on navigation (v1.23.1)

The v1.12.2 rule kept navigation silent. Robert asked for a buzz when the main
tab changes, so that rule now has two exceptions:

- **A tab change ticks** (`hapticTick`), whether it came from a tap on the bar
  or a swipe of the pager. The one place both paths reach is the tab index, so
  `PagedTabSlot` (`app-tabs.tsx`) ticks when that index changes. A re-press of
  the focused tab is a reset, not a change, and stays silent. So does the first
  render. On a swipe the tick arrives when the pager settles, not mid-drag.
- **A committed `SwipeNav` gesture ticks**: title → Reviews, the right-swipe
  close and back, and Android's pull-down close. It fires inside `fire()`,
  after the focus check, so a swipe that does nothing gets no buzz. The Feed's
  segment swipe goes through the same `fire()`, so its own handler no longer
  buzzes, which would have doubled it. A tap on the segmented control keeps
  its `hapticToggle`. Native gestures are left alone: iOS's swipe-back and the
  overscroll-to-close in `pull-to-dismiss.ts` are not ours to decorate.

The same pass closed some writes that had no feedback at all. A diary date
change, a profile save (edit and onboarding), an import that finishes or fails,
and a data export now use the same success/failure helpers as every other
write. A cancelled import has no error message and gets no buzz.

## Layout

```
src/lib/haptics.ts                    the only importer of expo-haptics
src/components/app-tabs.tsx           tab change tick (tap or pager swipe)
src/components/swipe-nav.tsx          tick on a committed navigation swipe
src/components/rating-bar.tsx         drag-to-rate: pan over the 1–10 scale
src/components/swipe-to-log-row.tsx   auto-commit swipe wrapper (log / undo)
src/app/_layout.tsx                   GestureHandlerRootView at the root
src/app/(app)/explore.tsx             Search: session state, checkmark, log/undo
src/app/season.tsx                    episode rows: swipe mirrors the +/− buttons
src/lib/use-session-log.ts            session-scoped optimistic log + exact-row undo
src/app/title/[id]/index.tsx          season rows: long swipe logs a season (+1)
src/lib/watches.ts                    return inserted ids; removeEpisodeWatchesByIds
src/components/icon-symbol.tsx        checkmark / arrow.uturn glyphs
```
