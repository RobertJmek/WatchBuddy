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

### Self-scoped read
A personal read written through `selectMine`, so it cannot accidentally return
every user's rows. Under the open-read RLS policy (watch data is world-readable;
writes stay owner-only), an unscoped `.select()` leaks all users' rows and
`.maybeSingle()` throws on the 2nd row. `selectMine` makes that leak impossible
to write by omission. Tables keyed by `id`-as-user (e.g. `profiles`) scope on
`.eq('id', uid)` with `currentViewer()`/`requireViewer()` instead.
