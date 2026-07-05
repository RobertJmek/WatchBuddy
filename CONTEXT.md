# WatchBuddy — Domain & Architecture Glossary

Shared vocabulary for the codebase. Architecture terms follow the
`/codebase-design` language (module · interface · depth · seam · adapter ·
locality · leverage).

## Seams

### Viewer
The one module (`src/lib/viewer.ts`) that answers "who is the signed-in user"
and "scope this read to them". Data modules go through it instead of touching
`supabase.auth` or hand-typing `.eq('user_id', …)`.

- `requireViewer()` — the viewer's id, or throw. For personal reads/writes.
- `currentViewer()` — the viewer's id, or `null`. For world-open reads that work
  signed-out, and for parametrised reads that may target another user
  (`getStats(userId?)`, `getDiary({ userId })`).
- `selectMine(table, columns)` — a **self-scoped read**: a SELECT with the
  viewer's `user_id` filter already applied. Chain further filters on the result.

### TV Time import
A one-time migration script (`scripts/import_tvtime.py`) that reads a TV Time
GDPR export and writes into WatchBuddy. Key mapping facts:

- TV Time `tv_show_id` = TVDB ID (resolved via TMDB `/find/{id}?external_source=tvdb_id`)
- Library status is inferred from `archived` flag + `nb_episodes_seen` vs TMDB total
- Only `key=watch-episode` rows in `tracking-prod-records-v2.csv` are first-watches;
  rewatch counts come from `rewatched_episode.csv` (`cpt` field)
- The script is idempotent: existing WatchBuddy rows win

### Self-scoped read
A personal read written through `selectMine`, so it cannot accidentally return
every user's rows. Under the open-read RLS policy (watch data is world-readable;
writes stay owner-only), an unscoped `.select()` leaks all users' rows and
`.maybeSingle()` throws on the 2nd row. `selectMine` makes that leak impossible
to write by omission. Tables keyed by `id`-as-user (e.g. `profiles`) scope on
`.eq('id', uid)` with `currentViewer()`/`requireViewer()` instead.
