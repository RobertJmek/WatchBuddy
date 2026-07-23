# ADR 0008 — In-app TV Time import + data export (through the app, not a service key)

**Status:** accepted · 2026-07-24

## Context

TV Time migration existed only as an offline Python CLI (`scripts/import_tvtime.py`)
that writes with the Supabase **service-role key**. That key bypasses RLS and
can't ship in a mobile app, so ordinary users had no way to bring their history
in. Separately, users had no way to get their data *out* (a GDPR-style export).

The hard constraint: the shared catalog tables (`titles`, `seasons`, `episodes`,
`genres`, `credits`, …) are RLS **read-only** for authenticated users — only the
`tmdb-proxy` Edge Function (service role) writes them. Per-user tables
(`library_items`, `episode_watches`, `movie_watches`) are owner-write under RLS.
So an in-app importer must populate the catalog *without* a service key, and
write history *as the signed-in user*.

## Decision

**Import** runs entirely client-side as the authed user:

- **Catalog writes are delegated to the Edge Function.** The importer calls the
  existing `fetchTitle` / `fetchSeason` proxy actions, which already upsert
  titles/seasons/episodes with the service role as a side effect — so the app
  never needs the key. A new **`find` action** (TMDB `/find/{id}?external_source=tvdb_id`)
  was added to `tmdb-proxy` because TV Time identifies shows by **TVDB id**.
- **Personal writes go through the viewer seam** (`src/lib/tvtime/db.ts`,
  `requireViewer`/`selectMine`) with the export's **historical `watched_at`** —
  the app's normal loggers stamp `now()`, so the importer has its own inserts.
- **Idempotency is prefetch-based** (the CLI's mechanism): before writing, it
  reads existing watches into a first-watch set + rewatch counts + movie dedupe
  keys, and skips anything already present. `episode_watches`/`movie_watches`
  have **no unique constraints**, so this is the only guard → the UI must forbid
  two concurrent runs and prefetch fresh each run.
- **Existing library rows always win** (deviates from the CLI, which overwrote
  status): the import must never clobber a status the user has since edited.
- **Unresolved titles get a manual-match UI in the flow** (pick from proxy search
  results or skip); picks are persisted in AsyncStorage so a re-run remembers them.
- **Pure logic is separated from IO** (`parse.ts`/`status.ts` are pure; `resolve.ts`
  hits the proxy; `engine.ts` orchestrates with a small concurrency pool + retry +
  `AbortSignal`) for testability and reviewability.

**Export** (`src/lib/export.ts`) gathers every row the user owns through the
viewer seam — profile, library, watches, ratings, review likes/replies,
notifications, follows (both directions) — plus **catalog lookups** for the
referenced titles/episodes so the file is self-describing, into one JSON handed
to the share sheet (`expo-sharing`).

Both live at the bottom of **Edit Profile**, next to Delete account.

## Consequences

- A full import is ~250–350 proxy invocations (1 title + 1 per watched season per
  show) at concurrency 3 — minutes, not seconds; cold-start latency is absorbed by
  a retry policy, and the screen keeps awake (`expo-keep-awake`).
- Cancel / background / kill mid-import is safe: a re-run rebuilds all dedupe
  state from the DB and skips what's there. The CLI and the in-app importer
  interoperate — either can run after the other.
- New deps: `expo-document-picker`, `expo-file-system` (SDK 56 `File().bytes()`),
  `fflate` (pure-JS unzip), `papaparse` (quoted CSV), `expo-sharing`, `expo-keep-awake`.
- The `tmdb-proxy` `find` action must be **deployed** before the import works
  on-device (done 2026-07-24).
- **Trap hit:** returning a bare Supabase builder from an `async` helper — `await`
  collapses (executes) it, so `.range()` blew up with "undefined is not a function".
  Both the importer and the export paginate through a `{ q }` wrapper (like
  `selectMine`). See AGENTS.md gotchas.
