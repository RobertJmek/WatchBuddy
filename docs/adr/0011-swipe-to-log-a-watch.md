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
- **A series needs a long swipe.** Movie/episode commit at ~28% of row width; a
  series (the heavy action) at ~60%. The long, deliberate swipe *is* the
  confirmation — no modal.
- **Undo = session-scoped, exact-rows.** A swipe-right records the precise ids it
  inserted (1 movie / N episodes) in in-memory Search state; undo deletes exactly
  those (`removeMovieWatch` / new `removeEpisodeWatchesByIds`). Undo is a no-op
  for a row you didn't swipe-log this session.
- **Movie undo restores Library status.** `logMovieWatch` also forces the title
  to `completed` (overwriting the prior status). The swipe reads the pre-log
  `library_items.status` first and restores it on undo (or `removeFromLibrary`
  if there was none) — a true reverse.
- **Feedback is a session checkmark, not a history badge.** After a swipe-right
  the Search row shows a teal ✓ meaning "I just logged this from here"; tapping it
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
  so the row shows a spinner while in flight; the checkmark appears on success.
- **The checkmark is ephemeral.** Leaving Search forgets it, though the watches
  persist in Diary/Stats. This is deliberate — it tracks the *gesture*, not
  watch history.
- **`expo-haptics`** was added for a light impact on commit → the shipped build
  must be rebuilt (native module). The rest of the feature is pure JS.
- **On-device tuning expected.** Thresholds are window-width fractions; the
  emulator misreports gestures, so the feel is validated on Robert's devices.
- **Startup-crash gotcha (fixed in v1.12.1).** v1.12.0 first shipped importing
  `ReanimatedSwipeable` from the `react-native-gesture-handler/ReanimatedSwipeable`
  subpath. That loaded a **second copy** of the `RNGestureHandlerButton` native
  component into the bundle (the main entry, already loaded by react-navigation,
  registers it too) → `Tried to register two views with the same name
  RNGestureHandlerButton` at launch. `expo export` builds fine (runtime, not
  bundle error); only an on-device run catches it. Fix: import `Swipeable` from
  the **main** entry only, so RNGH is loaded once. **Never mix the RNGH subpath
  imports with the main entry.**

## Layout

```
src/components/swipe-to-log-row.tsx   auto-commit swipe wrapper (log / undo)
src/app/_layout.tsx                   GestureHandlerRootView at the root
src/app/(app)/explore.tsx             Search: session state, checkmark, log/undo
src/app/season.tsx                    episode rows: swipe mirrors the +/− buttons
src/lib/watches.ts                    return inserted ids; removeEpisodeWatchesByIds
src/components/icon-symbol.tsx        checkmark / arrow.uturn glyphs
```
