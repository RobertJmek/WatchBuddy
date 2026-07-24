# ADR 0010 — Server-side statistics via the `get_stats` RPC

**Status:** accepted · 2026-07-24

## Context

`getStats()` (`src/lib/stats.ts`) built the whole statistics screen on the device.
It fanned out ~8 queries — every `episode_watches`/`movie_watches` row (paged past
the 1000-row cap), then catalog joins for genres, **credits (~16 rows per distinct
title)**, networks, library and ratings — and reduced all of it in JS on the main
thread. For a heavy user that is thousands of rows over the wire plus a large
synchronous reduction, on the two screens that call it (own stats, and another
user's public stats via the open-read model).

The reduction is mostly counting/grouping (genres, top people, decades, media
split, rating distribution) — tz- and locale-**independent** work that a database
does far better. The exception is the presentation layer: month/day/year bucketing
and streaks are **timezone-dependent** (they must match the device's local-time
`Date` math, including the `new Date('YYYY-MM-DD')` = UTC-midnight quirk), and the
labels (`"Aug"`, `"12 Aug 2024"`, status names) are **locale-dependent** via
`toLocaleDateString` — the server cannot know the device's `Intl` locale.

## Decision

- **Aggregate in one SQL RPC.** `get_stats(p_user_id, p_tz, p_now)` (migration
  `0013`) computes every metric server-side and returns a single small
  numeric/keyed `jsonb` payload. `security invoker` + open-read RLS, mirroring
  `get_feed` — it honours an explicit user id so it still serves another user's
  public stats.
- **Pass the device timezone, not wall-clock buckets.** `p_tz` (the device IANA
  zone) drives all `at time zone` day/month/year bucketing and streak math, so the
  server reproduces the client's local-time results exactly — including the
  release-date UTC-midnight quirk (`(release_date || 'T00:00:00Z') at time zone p_tz`).
  `p_now` is injectable (defaults to `now()`) purely so the output is deterministic
  under test.
- **Split the seam at labels.** The RPC returns keys, never locale strings:
  `monthly` as `{year,month,count}`, `busiestWeekday` as an index `0–6`,
  `biggestDay`/`busiestMonth` as ISO/`{year,month}`, `libraryStatus` as raw status
  values, `decades` as integers, `languages` as codes. The client's tiny
  `formatStats()` maps those to `toLocaleDateString` labels, weekday names,
  `LIBRARY_STATUSES` order, `"1990s"`, uppercased codes.
- **Deterministic tie-breaking.** Ties on equal counts now sort by name (and
  dates/months by value) instead of the previous arbitrary fetch/insertion order —
  same values, stable order.

## Consequences

- **Verified bit-exact.** A local-Postgres differential harness runs the previous
  `getStats` reduction (the trusted oracle) against `get_stats` + `formatStats`
  over the same seed, and they match exactly across 6 scenarios (empty, heavy
  1500+ watches, year boundary, DST spring/autumn, streaks, rewatches, ratings on
  unwatched titles, null runtimes/release_dates) under 3 timezones including a
  negative offset (`America/New_York`). Kept in the perf-audit scratchpad; not
  shipped.
- **One ~19 ms query, ~3 KB, zero client CPU** replaces ~8 round-trips and a
  thousands-of-rows reduction. Benchmark: heavy user (6000 watches, 1920 credit
  rows) → old path transferred ~8000+ rows; new path is a single RPC.
- **The RPC is the contract.** New stats need SQL, not JS. The `Stats` type and
  the screen are unchanged; only the fetch/reduce layer moved.
- **`p_tz` correctness depends on a valid IANA zone.** `formatStats` falls back to
  `'UTC'` if `Intl.DateTimeFormat().resolvedOptions().timeZone` is unavailable.

## Companion performance work (same release, v1.11.1)

- **`ratings (entity_type, entity_id)` index** (migration `0012`).
  `getTitleRatings()` (community section on every title screen) filters that pair
  across all users; no existing index covered it (PK on id, unique on
  `(user_id, entity_type, entity_id)`, index on `user_id`), so it seq-scanned.
  Proven locally: Seq Scan → Index Scan (4.9 ms/618 buffers → 0.07 ms/25 buffers),
  and the scan grew with total ratings app-wide.
- **Episode read-through** (`src/lib/tmdb.ts`). `fetchAllEpisodes` (the TV
  watch bar) called the `tmdb-proxy` edge function once per season. It now reads
  cached episodes from Postgres in a single query and invokes the edge function
  only for missing/stale seasons — mirroring `getTitle`'s read-through. Revisiting
  a cached show collapses N edge round-trips into one query.
