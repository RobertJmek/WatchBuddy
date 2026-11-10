# ADR 0033 — Hold menu on titles

**Status:** accepted · v1.27.0

## Context

Logging a title or changing its Library status meant opening its page. Robert
asked for a menu on a held title, anywhere a title shows. He rejected the
native action sheet and an overlay that stayed up for a second tap: the title
should stand out over a blurred page, and one touch should open the menu,
reach an option and choose it.

## Decision

- **One continuous touch.** `TitleHold` wraps a poster or row in an RNGH pan
  with `activateAfterLongPress(350)`. Hold: the poster lifts (128x192) over a
  blurred, dimmed page. Slide onto an option and let go to choose it; let go
  anywhere else and nothing happens.
- **One host.** `TitleMenuHost` is mounted once in the root layout as a plain
  overlay (not a `Modal`) and hit-tests the finger by geometry.
- **Rows:** Log, favorite, Watchlist, Rate (opens the title), Share. Under
  them, one row of the other statuses (Watching, Completed, On hold, Dropped),
  the current one drawn inverted. Nothing in the menu deletes, except that a
  title on the Watchlist can leave it. A new row is one entry in `useActions`
  plus `ROWS`.
- **A row lights only after 24pt of finger travel.** The menu can open under
  the finger, and a still release must never choose.
- **Placement.** The poster lifts where it is. The menu opens under it, or
  over it when the title sits low; over it the rows reverse, so Log is always
  nearest the finger. The poster moves only when neither side fits.
- **Optimistic.** A log changes the Library status, the Library list and the
  watch count on release; the refetch replaces them with the server's state.
  A title not yet in the Library joins Completed as a stand-in row.
- **Counts.** The Log row ends in "x2" from the same queries as the title
  page's watch bars (`seriesPassesOptions` for a series).

## Consequences

- `expo-blur` is a new native module: the build needs a new binary. A binary
  without it gets a plain dim.
- Gesture callbacks call module functions and never name the host. A callback
  keeps what it closed over when created, and a poster in a memoized list is
  created before the host mounts.
- Outside Search a log from the menu has no on-screen confirmation and no
  undo there; it is undone from the title page.
- A failed log started from a Search row leaves its stand-in Library row
  until the list next refetches.
- The menu is not reachable by a screen reader; every action is still on the
  title page.
- Client only. No backend change, so installed builds are unaffected.
