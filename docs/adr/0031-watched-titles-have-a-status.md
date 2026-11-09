# ADR 0031 — A watched title always has a Library status

**Status:** accepted · backend only (migration 0023), no app release

## Context

The WatchBuddy-export importer writes watches and no library rows (ADR 0009,
"No library status is set"). A friend who imported an export got every title in
the Diary and Stats and none on the Library shelves. Logging one episode with
`+` on a show that wasn't in the Library left the same gap.

Robert's rule: you can't have watched something without it having a status. A
movie you watched is Completed. A series is Completed once you've seen every
aired episode, otherwise Watching.

## Decision

- **The database enforces it.** A statement-level `AFTER INSERT` trigger on
  `episode_watches` and `movie_watches` inserts a `library_items` row for each
  (user, title) in the statement that has none. Installed builds get the fix
  without an update, and both importers are covered, old builds included.
- **Status:** movie → `completed`. Series → `completed` when every aired episode
  (season ≥ 1, `air_date` ≤ today) has a watch, else `watching`. A returning
  series you're caught up on is Completed, as with "Log whole series". When the
  catalog cache can't prove the show is finished (an aired season with no cached
  episodes), the answer is `watching`; a wrong guess errs that way.
- **Never overwrite.** `on conflict do nothing`: a status the user picked wins,
  and finishing a Watching show doesn't promote it.
- **Dated by the latest watch.** `created_at`/`updated_at` take the latest
  `watched_at`, so an imported history sorts among old titles instead of at the
  top of the Library and profile shelves.
- **Backfill everything.** Every existing watched title without a row gets one.
  Titles a user removed from the Library while keeping their watches come back
  too; Robert accepted that (it can't be told apart from the import gap). Removing
  them again holds, since the trigger fires only on new watches.

## Why a trigger here, when ADR 0024 rejected one

ADR 0024 rejected a trigger that *logs watches* from a rating or a status: a
series' episodes aren't reliably in Postgres, and importers would get duplicate
"now" watches. This goes the other way, from watches to a status. It only reads
the catalog cache and writes no watch, and the uncached case falls back to
Watching.

## Consequences

- Installed builds: every client path that writes `library_items` after a watch
  upserts (`setLibraryStatus`, the TV Time importer's `ignoreDuplicates` upsert,
  the Python script), and `setFavorite` inserts only after its update found no
  row, so none of them hits a unique violation.
- The swipe-to-log and implied-watch undos still restore "no status" correctly:
  they delete the watches, then remove the row when there was no prior status.
- Undoing a single episode `+` on an untracked show leaves it in Watching.
- The helper `watched_title_status` and the trigger function are server-only
  (EXECUTE revoked from `anon`/`authenticated`); the trigger function is
  `security definer` and only writes rows for user ids that passed the watch
  tables' RLS.
