# ADR 0013 — Filtering the library

**Status:** accepted · 2026-07-26

## Context

The Library screen was a set of poster shelves — one per status, plus two
favorites shelves — with exactly one narrowing tool: a title text search.
`library-section`, the grid a shelf header opens, had no controls at all.

That is fine at thirty titles. It is useless at three hundred, which the TV Time
importer (ADR 0008) can produce in an afternoon. Two questions people actually
ask of their own library had no answer: *"which of these is a horror film"* and
*"what did I rate 8 or 9"*.

Three properties of the existing code shaped the answer:

- Both screens read the **same** `['library']` query, and `getLibrary()` already
  returns **every** row. The data to filter on is either already in memory or one
  select away — this is not a paging problem.
- `ratings.entity_id` is a **polymorphic uuid with no FK** (`0001_init.sql`): it
  can point at a title, a season or an episode. PostgREST cannot nest ratings
  under `library_items`.
- Genres exist as `title_genres` + `genres`, both world-readable, so genre ids
  can be nested into the existing title select for the cost of a few integers
  per row.

## Decision

One filter control, shared verbatim by Library and by every category, over four
axes: **media type, genre, release year, the viewer's own rating**. A filter icon
opens a modal sheet; what's active renders as removable chips under the header;
the header count becomes `X of N Titles`.

### Semantics

- **AND between axes, and AND *within* the genre axis.** Horror + Thriller means
  a title carrying both. The alternative (OR within an axis) is the more common
  convention and was the recommendation; AND was chosen deliberately. The
  consequence is that narrowing always shrinks, so **zero results is a routine
  state**, not an edge case — both screens therefore render a filter-specific
  empty state offering Clear.
- **An interval axis spanning its full domain is off.** Year and rating are
  `null` when inactive; `normalizeRange` is what turns "dragged back to both
  ends" into that null. Accepted trade-off: *"everything I've rated, any score"*
  is not expressible.
- **An active interval excludes rows with nothing to compare.** An unrated title
  cannot satisfy "rated 6 to 8"; a title with no release date cannot satisfy
  "released 1990 to 1999". Both vanish only while the respective axis is
  narrowed.
- **Sort is explicitly out of scope.** Order stays `created_at` desc. Sorting has
  its own questions (does alphabetical ignore "The"? added date or release
  date?) and shipping it here would have doubled the surface to test.

### Interval axes are dual-thumb sliders

Year and rating are **two-thumb sliders**, the shape a price filter has in every
online shop. An earlier iteration used typed numeric fields, on the reasoning
that no thumb drag over ~50 years lands on the year you meant; that was rejected
in favour of the recognisable control.

`RangeSlider` follows the drag idiom of `rating-bar.tsx` (ADR 0011's follow-up):
a single `Gesture.Pan` with `.runOnJS(true)` over plain React state — a whole
drag is a few dozen integer updates, so there is nothing for a worklet to win.
The nearer thumb is the one a touch grabs; when both sit on one value, which side
of them the finger is on decides, so a collapsed range reopens in either
direction.

Haptics narrate the drag, all through `lib/haptics.ts`: a tick on pickup (a grab
usually lands on the thumb's current value, so `moveTo` has nothing to report and
the gesture would otherwise start in silence), a tick per step crossed — never
per frame, never while a thumb is pinned against the other — and one of **three**
endings on release, mirroring `rating-bar`'s care about no-op drags: a committed
range confirms, a drag back to full span reads as an **undo** (the axis just
turned off, which is a retraction), and putting a thumb back where it was stays
**silent**.

### Cross-screen state

The filter travels Library → category as **router params** and is editable there,
but changes never write back: press Back and Library is exactly as it was. State
is screen-local and dies with the screen; re-tapping the Library tab clears it,
alongside the search and scroll reset that gesture already performed.

Rejected: a shared bidirectional store (surprising on Back, and nothing in the
app works that way today) and fully independent state (losing the filter exactly
when you tap through to see the full list).

### Favorites collapse

`Favorite Movies` / `Favorite TV` become a single **`Favorites`** shelf, since
media type is an axis now. This also aligns Library with the public profile,
which has always rendered one Favorites shelf — the change closes a divergence
rather than opening one.

### Data

`getLibrary()` returns a richer `MyLibraryEntry`: genre ids (nested, bare ints,
no join) and `myRating`. The rating comes from a **second select run in
parallel**, because of the polymorphic `entity_id` above, paired client-side by
title id. `LibraryEntry` — what `getLibraryFor` returns for *other* people's
profiles — is untouched, so no field is ever populated for one caller and null
for another.

Genre names come from the world-readable catalog under `['genres']` with
`staleTime: Infinity`; the AsyncStorage persister in `query.ts` makes them free
after the first run. The sheet only offers genres the library actually contains,
so there are never chips that can only return nothing.

**No migration. No Edge Function change.** Filtering is client-side over data
already in the cache. A server-side RPC (the `get_stats` shape, ADR 0010) was
rejected: filtering is interactive, and a round trip per chip tap would trade 0 ms
for 150–300 ms to solve a problem that doesn't exist while the whole library
fits in memory.

## Consequences

- **Filtering logic is a pure module** (`src/lib/library-filter.ts`): no
  supabase, no React, data in and data out, like `tvtime/parse.ts`. It is the
  only part of the feature checkable without a device, and it was verified
  against a 32-assertion throwaway harness (AND genres, both exclusion rules,
  full-range-is-off, param round-trips, garbage-param degradation). The project
  has no test runner; that harness pattern is the substitute.
- **A payload that grew, paid for by fetching less.** The unconditional
  `refetch()` on every Library tab focus is gone. Every write that can change the
  list already invalidates `['library']`, and `library-section` reads the same
  key, so backing out of a category triggered a second full download — two per
  visit. `rating-bar` now invalidates `['library']` too, since the viewer's
  rating became part of that payload; `review-thread` deliberately does not, as
  editing a review's text preserves the value and cannot move the axis.
- **Two Android-specific traps, avoided by design rather than discovered.** An RN
  `Modal` renders in its own window, outside everything `_layout.tsx` provides:
  the sheet therefore mounts its **own `GestureHandlerRootView`** (without it the
  sliders' pan never fires), and it does **not** use `useKeyboardState` (the
  `KeyboardProvider` isn't in scope either). Separately, Android clips a child
  taller than its parent, so the 24px thumbs are children of the padded row, not
  of the 4px track, and thumb travel is `rowWidth - THUMB` so no `left` is ever
  negative.
- **The sheet's exits each mean one thing**: the X and the backdrop cancel (the
  draft is discarded), Apply commits, Clear empties the draft without leaving.

## Follow-up (v1.14.1): the genre fold, and what opening the sheet cost

Shipped as a follow-up to this ADR rather than one of its own — the decisions
below refine the sheet, they don't replace anything above.

**Every genre at once was the wrong default.** A library spans ~25 genres, the
chip row wraps, and the sheet is capped at 70% of the screen: both sliders were
pushed below the fold, so the two axes you cannot discover by scanning were the
two you had to scroll to reach. The sheet now shows **8 genre chips** — about two
rows — behind a `Show all (N)` / `Show less` disclosure, which puts Year and
My rating on the first screen.

Which 8 is the question the fold creates, and the answer is **most-used first**,
counted over the viewer's own library (`genreOptions`, pure, in
`library-filter.ts`). Alphabetical was the alternative and was rejected: it gives
a genre a fixed position (muscle memory) but spends the visible slots on whatever
starts with A. Ordering by use spends them on the genres this particular library
is made of. Ties break alphabetically, which keeps the long tail — every genre
owning a single title — stable between openings.

The fold cannot hide an active selection: opening the sheet with a genre picked
from below the fold **opens expanded**, because a selected chip you can't see is
a filter you can't undo from where you'd look for it. `genreOptions` also
absorbed the "only genres the library contains" rule, which used to be a
`availableGenreIds: Set` prop the sheet filtered by — the sheet no longer decides
which genres exist, only how many to show at once.

**The sheet was slow to open, and the genres were not the reason.** Opening it is
a `setState` on Library, so React re-rendered the whole screen first: `applyFilter`
over every entry, then all six shelves and every poster in them, since none of it
was memoized and `PosterShelf` was not a memo component. The sheet only appeared
after that work. So the derived values (`visible`, `shelves`, the genre and year
inputs, the header counts) are now `useMemo`d, each shelf carries its own stable
press handler, and `PosterShelf` is `memo`'d with a stable `renderItem`. The
category screen got the same treatment for its grid. No behaviour changes; a tap
on the filter icon just stops re-deriving the library to draw a modal over it.
