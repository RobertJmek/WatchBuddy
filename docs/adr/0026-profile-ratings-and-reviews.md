# ADR 0026 — Ratings and reviews on a profile

**Status:** accepted · targets v1.23.8

## Context

A public profile (`/user/[id]`) showed stats, taste, library shelves and the
diary, but nothing a person had rated or written. Their reviews were reachable
only title by title, and there was no data-layer read for "every rating by
user X".

## Decision

- **Two blocks on the profile**, between the library shelves and *Recent
  activity*: a **Ratings** poster shelf (the 10 newest, each poster carrying
  its score in a corner badge) and a **Reviews** preview (the 3 newest written
  reviews: poster, title, score, the first three lines). Each header shows the
  total and opens a full screen. A block with nothing in it is not shown.
- **One full screen, `user/[id]/ratings?kind=ratings|reviews`.** Ratings are a
  3-column poster grid, reviews a list. A **Recent / Highest / Lowest** control
  re-sorts on the server; pages of 30 by `.range()`.
- **A review opens its thread; a score opens the title.** Likes and replies
  stay in the thread — the profile rows carry no like button.
- **Your own profile shows the same section.** "View my profile" goes through
  the same screen and there is nothing to hide from yourself.
- **Titles only.** `ratings.entity_type` allows `season` and `episode`, but the
  client never writes them; the read filters on `movie` / `show`.

`getUserRatings` in `src/lib/ratings.ts` reads one page plus an exact count,
then the titles in a second select (`entity_id` is polymorphic, so PostgREST
cannot nest it — the same reason as `getLibrary`). Recent order uses
`ratings_user_updated_idx` (0017); `id` is the last sort key so paging is
stable. Keys live under one root, `keys.ratingsBy(userId, …)`, invalidated
bare wherever a rating, a review text or visibility changes (rating bar, review
thread, block, report).

**Blocks need no new code.** The 0020 read policies already withhold a hidden
user's `ratings`, and the profile shows its blocked / unavailable state before
any section renders. A review you reported is hidden from you here as well.

## Consequences

- No SQL, no edge change, no native dep.
- Sorting by score is a seq over that one user's ratings (no `(user_id, value)`
  index). A heavy rater has hundreds of rows, not millions; add the index if it
  ever shows up.
- The badge on a poster is new UI in `PosterShelf` / `GridPoster` (`badge`), and
  `PosterShelf` gained `count` for a header that previews a longer list.
