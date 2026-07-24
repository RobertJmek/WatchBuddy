# ADR 0009 — Import a WatchBuddy export (adopt a watch history into your account)

**Status:** accepted · 2026-07-24

## Context

WatchBuddy already produces a self-describing JSON **data export** (ADR 0008,
`src/lib/export.ts`): every row the viewer owns plus a catalog lookup table for
the ids those rows reference. There was no way to read one back in. We want the
inverse — pick an export file and write its **watch history** into your account,
including an export produced by *someone else* (adopting their history as your
own, e.g. a friend handing you their file, or restoring after a re-signup).

The catalog (`titles`/`seasons`/`episodes`) is a single **shared table** on the
same backend, so the export carries `tmdb_id`/`media_type` per title and
`season_number`/`episode_number` per episode. The raw catalog UUIDs in the export
*happen* to be reusable, but binding to them would couple the importer to catalog
row identity staying stable forever.

## Decision

- **Re-resolve through TMDB, never trust the export's UUIDs.** Every referenced
  title is resolved with `getTitle(tmdbId, mediaType)` and every episode via
  `fetchSeason(tmdbId, season)` — the same path the TV Time importer uses. This
  decouples the importer from UUID stability and, as a side effect, repopulates
  the shared catalog server-side (tmdb-proxy) when a row is missing locally.
- **Scope: watch history only.** We import `episode_watches` + `movie_watches`
  (with their original `watched_at` and `is_rewatch`). Library statuses,
  ratings/reviews, follows, notifications, likes and replies are **excluded** —
  they are relational/social and don't make sense adopted into another account.
- **Skip on conflict; never overwrite.** Idempotent and re-runnable, mirroring
  the TV Time importer: an existing episode first-watch wins; episode rewatches
  dedupe per-event on `(episode_id, watched_at@second)`; movie watches dedupe on
  `(title_id, watched_at@second)`. A re-run inserts nothing.
- **Explicit "someone else's history" consent.** The screen states the file may
  be another person's export and that its watches are saved **under your account
  as your own**; the confirm action reads "Yes, import as mine".
- **Version the format.** `export.ts` now emits `schema_version: 1`. The importer
  accepts `1` and a **missing** version (legacy exports share the shape → v0), and
  rejects a newer version with a clear "update the app" message.
- **One entry point, a chooser inside.** Edit Profile has a single "Import your
  data" row → `import-data.tsx`, which offers **TV Time** (ZIP) and **WatchBuddy**
  (JSON), each routing to its own screen.

## Consequences

- **No library status is set.** Imported shows/movies populate the **Diary and
  Stats** (both watch-based) but do **not** appear on the Library shelves unless a
  row already exists. Deliberate scope choice; trivially extendable later with one
  `setLibraryStatusIfAbsent` call per resolved title.
- **Massive reuse.** The viewer-seam inserts and first-watch/movie dedupe
  prefetch come straight from `src/lib/tvtime/db.ts`; only per-event episode
  rewatch dedupe (`prefetchEpisodeRewatchAtKeys`) is new (`src/lib/wb-import/db.ts`).
  Exact `tmdb_id`s mean **no fuzzy matching and no manual-match queue** — the
  resolve phase is just a TMDB fetch per distinct title.
- **Safe to cancel/kill mid-run.** Like TV Time, dedupe state is prefetched fresh
  each run; a re-run skips everything already written. Two concurrent runs must
  never be allowed (the watch tables have no unique constraints).
- **Second-precision dedupe** means two genuinely distinct watches of the same
  title within the same second collapse to one — an accepted, negligible edge.

## Layout

```
src/lib/wb-import/
  types.ts    plan / progress / summary types
  parse.ts    pure: validate app + schema_version, re-key watches to TMDB coords
  db.ts       reuses tvtime/db.ts inserts + prefetch; adds rewatch atKey prefetch
  engine.ts   resolvePlan (TMDB) + runImport (episodes → movies), cancellable
src/app/
  import-data.tsx        chooser hub (TV Time / WatchBuddy)
  import-watchbuddy.tsx  the WatchBuddy-export flow
```
