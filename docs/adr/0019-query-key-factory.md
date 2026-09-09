# ADR 0019 — One query-key root per resource

**Status:** accepted · targets v1.16.1 (fixes a stale-screen bug)

## Context

Query keys were written as array literals at every call site — roughly 70 of
them across 27 files. That is survivable on its own; TanStack matches keys by
**prefix** by default, so a bare `invalidateQueries({ queryKey: ['stats'] })`
reaches `['stats', anything]` too, and most of the app relied on exactly that.

What was not survivable was that three resources had **two different root
names** depending on whose copy they were:

| yours | someone else's |
|---|---|
| `['stats']` | `['userStats', id]` |
| `['library']` | `['userLibrary', id]` |
| `['diary']` | `['userDiary', id]` |

Prefix matching cannot bridge differing roots. And `user/[id]/index.tsx`
computes `isMe` — it *knows* it may be showing you — and reads the `user*` keys
regardless.

**So: log a watch while your own profile is open at `/user/[id]`, and that
screen goes stale.** Every mutation in the app invalidates `['stats']`,
`['library']` and `['diary']` — about thirteen call sites — and not one of them
touches `['userStats', <you>]`. The screen only recovers on a manual refresh or
a remount.

Worth recording because it was the stated reason for this work and it is wrong:
the audit that raised this claimed the defect was a follow from a profile
failing to invalidate your own `['followCounts']`. It doesn't.
`follow-button.tsx` invalidates `['followCounts']` with no id, and prefix
matching already carries that to `['followCounts', myId]` and
`['followCounts', id]` alike. That path has always worked.

## Decision

**`src/lib/keys.ts` owns every key, and a resource has exactly one root.** Whose
copy it is goes in the **suffix**, never in the root name:

```ts
keys.stats()      // ['stats']       — yours
keys.stats(id)    // ['stats', id]   — theirs, and reached by the bare one
```

so a bare invalidation covers both by prefix, which is the property the codebase
was already assuming everywhere else. Every `useQuery`, `invalidateQueries` and
`setQueryData` goes through the factory; `library-status-bar`'s local
`STATUS_KEY` helper is gone.

`lib/tmdb.ts` keeps its own `['title', mediaType, tmdbId]` key. It is the
read-through cache for the **shared catalog** rather than anyone's personal
data, it already spelled its key this way, and it was the model for the style.

### Two shapes preserved rather than normalized

- **The diary's own filtered key** stays `['diary', period, from, to]`, now
  spelled `[...keys.diary(), period, …]`. Same bytes, so nothing already sitting
  in the seven-day persisted cache is orphaned. It coexists with
  `['diary', <uuid>]` because a period name is never a uuid.
- **`['trendingPage', 1, mediaType]` keeps its `1`.** That is a **payload-shape
  version, not a page number** — it exists to orphan the malformed pages the
  pre-pagination proxy wrote into the persisted cache in v1.16.0 (see ADR 0015).
  `keys.ts` says so at the one place someone would be tempted to bump it for
  paging.

## Consequences

- The stale-profile bug is fixed, and the fix is structural: a future
  `['userFoo', id]` is now the obviously wrong thing to write.
- **`['stats']` and `['stats', <you>]` are still two queries** with two fetchers
  (`getStats()` and `getStats(you)`), so viewing your own profile fetches your
  statistics twice. That is unchanged behaviour — before, they were two queries
  under two roots — but it is now visible in one file and is the natural next
  thing to collapse.
- A bare invalidation is broader than it used to be: `keys.stats()` now
  refetches every loaded profile's stats, not just your own. Those are at most a
  couple of screens deep, and refetching a stale profile is the correct outcome.
- `keys.ts` is the place to look for what a screen caches, which was previously
  a `grep` across 27 files.
