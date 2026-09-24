# ADR 0024 — Implied watch: rating or completing a title logs it as watched

**Status:** accepted · targets v1.21.0

## Context

Rating a title and marking it Completed both say "I've seen this", but neither
wrote a watch. Only the reverse existed: `logMovieWatch` promotes a movie to
Completed. So a rated or completed title could be missing from the Diary and
the statistics until you also pressed "Log watch".

## Decision

A new `ensureWatched(title, { onlyIfUntouched })` in `src/lib/watches.ts`
makes sure the title counts as watched, and never logs a second time.

- **Movie:** one watch, only if there is none yet. It goes through
  `logMovieWatch`, so a movie rated from the Watchlist also moves to Completed.
- **Series:** every **aired** episode (Specials excluded, `air_date` ≤ today,
  unknown dates count as not aired) that has **no** watch yet.

It is called from two places, both in the UI:

1. **`RatingBar`, on a first rating only** (`previous == null`), with
   `onlyIfUntouched: true`. A series with any watched episode is left alone:
   rating a show you're halfway through is an opinion, not a claim you've
   finished it. Changing a rating (7 → 8) or clearing it never logs.
2. **`LibraryStatusBar`, when the status becomes Completed**, with
   `onlyIfUntouched: false`. It fills in whatever isn't logged yet.

The implied watch is dated **now**. Clearing the rating or leaving Completed
**does not** remove it; a watch is a fact, not a derived flag. A short note
under the control offers an **Undo** for ~5 s, which reverses exactly the rows
that were written, plus a movie's prior Library status (`useImpliedWatch` in
`components/implied-watch-note.tsx`). A failure never reverts the rating or
status that triggered it.

`MovieWatchBar` moved from local state to a `useQuery` on the new
`keys.movieWatches(titleId)`, so a watch logged by the rating shows up in
"Watched N×" on the same screen.

### The aired rule covers every bulk log

`ensureWatched` keeps only **aired** episodes, and the same rule
(`airedOnly` in `watches.ts`) now applies to every other bulk log: "Log whole
series", "Log whole season" (disabled when nothing in the season has aired),
and the series swipe in Search (which rolls its ✓ back when there is nothing
to log). Before, all three logged future episodes of a show still airing. A
single episode's `+` stays unrestricted: it is an explicit choice about one
episode, and TMDB's dates can lag behind a real release.

## Why not inside `setRating` / `setLibraryStatus`, or a trigger

- The Search swipe-to-log undo restores a prior `completed` status through
  `setLibraryStatus`. A hook there would re-log what was just undone.
- Both importers write statuses and ratings next to **historical** watches. An
  automatic "now" watch would duplicate every imported title.
- A database trigger cannot log a series: its episodes are not reliably in
  Postgres, they are fetched through `tmdb-proxy`.

## Consequences

- Rating an old favourite puts it in today's Diary and today's statistics.
  Accepted; a watch with no date would need a schema change and a Diary rule
  for it.
- Rating a completed series with a long run can write hundreds of episode rows
  in one go, the same as "Log whole series".
- The feed shows the watch alongside the rating, as it would if you'd logged it
  by hand.
