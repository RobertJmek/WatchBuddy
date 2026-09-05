# 0016 — Backend hardening: feed indexes, narrowed write grants, upstream budgets

**Status:** accepted · targets v1.16.1

## Context

Nothing here is a feature. It is a pass over the parts of the backend that were
correct for the app as written but not defended against the app growing, being
called by something other than the app, or being called too often.

Four problems, in descending order of how much damage they can do:

1. **The two upstreams were unbounded.** `tmdb-proxy` runs with the service-role
   key and calls TMDB and OMDb on the caller's behalf. OMDb's free tier is
   **1,000 requests a day for the whole app** — not per user. Any signed-in
   account could spend that in a couple of minutes of scripted `title` calls,
   and IMDb ratings would then be missing for everyone until midnight. Nothing
   counted, nothing refused.

2. **Parameters went straight into URLs and queries.** `media_type` was
   interpolated into `/${mediaType}/${tmdbId}` with nothing checking it was one
   of two words; `tmdb_id`, `season_number` and `page` were not checked to be
   numbers at all; and the catch-all handler returned `String(err)` to the
   client, which is how a Postgres error message or an upstream URL ends up in
   an alert on someone's phone.

3. **`get_feed` had no index to read through.** Six UNION branches each filter
   `user_id in (followees)`. `review_likes` and `review_replies` had **no index
   with `user_id` as a prefix at all**, so both branches sequentially scanned
   their whole table on every Feed open, for every viewer. The `episode_watch`
   branch aggregated a followee's *entire* watch history before the visibility
   window was applied.

4. **The notification "mark read" policy permitted more than its name.** It is
   an unrestricted `for update` on your own rows, so the owner could rewrite
   `type`, `actor_id` or `actor_count` — inventing notifications that never
   happened. 0016 already noted the name had grown narrower than the grant.

## Decision

### Token buckets live in Postgres, not in the isolate

`rate_limits` + `consume_rate_limit` (migration `0018`). An edge isolate has no
memory worth the name — it is created per burst, several run at once, and each
starts empty — so a counter inside the function limits nothing. The bucket is a
row.

The whole spend is **one statement**: `insert … on conflict do update … where
<refilled balance> >= cost`. Read-then-write would let two concurrent requests
read the same balance and both spend it, which is the *normal* case here since
the app fires several proxy calls at a time. Measured on a local Postgres, 8
workers × 25 calls against a capacity of 50 allow exactly 50; the read-then-write
shape allows all 200.

Capacity and refill are passed **per call**, not stored, so retuning a limit is
a function deploy rather than a migration.

Three buckets:

| bucket | subject | capacity | refill | why |
|---|---|---|---|---|
| `tmdb-proxy` | caller uid | 300 | 40/s | sized off the TV Time importer, the heaviest legitimate client (3 concurrent resolutions × up to 3 TMDB pages ≈ 30 upstream req/s) |
| `tmdb-proxy` | nil uuid | 30 | 1/s | callers presenting only the publicly-embedded anon key, sharing one bucket |
| `omdb` | nil uuid | 100 | 700/day | global, because the quota is global |

The per-user ceiling is deliberately set at roughly *what one honest heavy user
needs*, not at what a careful user needs. It exists to stop a runaway loop or a
script from monopolising a shared budget; throttling an import would be a
regression, not a defence.

**Spending fails open.** If the limiter itself errors, the request goes through
and the error is logged. A broken accountant must not be able to close the shop.

### The caller's identity is a claim, not a check

A per-user bucket needs a user, and the function had never looked at who was
calling — `verify_jwt` did that, outside it. Rather than ask the auth server on
every request, `callerId()` reads the `sub` claim out of the token the gateway
**already verified** and does not re-verify it.

That is safe only because of how the claim is used: it picks a rate-limit
bucket, and nothing else. Every read and write in the function still goes
through the service-role client under the same rules as before, so a forged
`sub` would buy an attacker a fresh quota — the thing the *global* OMDb bucket
exists to make worthless — and no data access at all. If `verify_jwt` were ever
turned off for this function, that is the property that would need revisiting.

A caller with no `sub` is not rejected: the anon key is publicly embedded in the
app and presenting it is legitimate. Those callers share one tight bucket.

### Running out of OMDb budget degrades, it does not fail

The title still loads, without its IMDb rating.

With one rule attached: **only an actual answer from OMDb may change the stored
value.** A refused lookup — and, for the same reason, a missing `OMDB_API_KEY` —
now leaves whatever rating the row already had instead of overwriting it with
null. The old code called `imdbRating()` unconditionally on every refetch, so
unsetting the key (or, from now on, a busy hour) would have quietly wiped
ratings the app had already collected. An answered lookup that returns nothing
still clears the value, which is the case where "no rating" is the truth.

That degradation is only tolerable because of the second half:

### `titles.imdb_checked_at`

The cache gate forced a full refetch of any title that *could* carry an IMDb
rating but did not (`imdb_id` known, `imdb_rating` null), so that setting the
OMDb key backfills on the next view. For a title **OMDb simply has no rating
for**, that condition is permanent: the row never satisfies the gate, and every
view of it costs a TMDB refetch *and* one of the 1,000 daily OMDb requests,
forever. "Not asked yet" and "asked, and told nothing" were indistinguishable.

The new column records when OMDb was last asked, **whether or not it answered**,
and the proxy re-asks on its own shorter TTL (`IMDB_RECHECK_HOURS`, default 24).
A rate-limited lookup stamps the column too — otherwise the very next view comes
straight back, which is the cache-defeating loop this removes.

`src/lib/tmdb.ts` mirrors the rule, as it already mirrors the title TTL. Being
wrong there costs one edge call that the server then answers from cache.

### The feed window is pushed into each branch

Four new indexes, one per branch that had nothing usable:

| index | why |
|---|---|
| `review_likes (user_id, created_at)` | the table had **no** `user_id`-prefixed index at all — PK is `(rating_id, user_id)` |
| `review_replies (user_id, created_at)` | same — its only index is `(rating_id, created_at)` |
| `ratings (user_id, updated_at)` | `(user_id)` existed but not carrying the timestamp the branch bounds on |
| `follows (follower_id, created_at)` | same, off the PK's leading column |

...and the visibility bound moved from the outer `WHERE` into every branch so it
can be an index condition. The outer filter **stays** — it remains the
definition of the window; the pushdowns are a superset of it.

The `episode_watch` branch is the interesting one. It aggregates per (user,
title, calendar day) and emits `max(watched_at)`, so filtering `watched_at > lo`
there would be **wrong**: a group straddling the bound keeps its max but loses
rows from `count(*)` — "watched 6 episodes" silently becomes "watched 2". That
branch is therefore bounded by whole **days**. Every row of a group shares one
calendar day, so a day bound keeps a group entire or drops it entire, and a
group whose max exceeds `lo` sits in a day at or after `lo`'s day.

Verified rather than argued: a differential harness on a local Postgres compared
the old and new functions over **16,128 cases** (4 seeds × 4 timezones × 9
viewers × 28 `p_before` values including real event instants and midnights × 4
limits) with zero differences, and the naive instant-based pushdown — installed
as a negative control — produced 289 mismatches.

What that buys, measured on a 250k-row dataset: the old function sequentially
scans 250,700 `episode_watches` rows and 250,400 `review_replies` rows and runs
in ~152 ms; the new one seq-scans **nothing** (`pg_stat_user_tables` reports
zero on all four tables, and each new index takes one scan per followee) and
runs in ~17.5 ms.

### Column privileges, not a policy, decide which columns

RLS cannot restrict columns. So the policy keeps deciding **which rows** (yours)
and a grant decides **which columns**:

```sql
revoke update on public.notifications from authenticated;
grant update (read_at, dismissed_at) on public.notifications to authenticated;
```

Those are exactly the two the client writes (`markRead`/`markAllRead`,
`dismiss`/`undismiss`). Verified as `authenticated`: both succeed, `actor_count`,
`type` and `actor_id` are refused.

Alongside it, `actor_count >= 0` as a constraint and `greatest(actor_count - 1, 0)`
in the two aggregating triggers — the floor is zero, which is also the value the
drop-at-zero `DELETE` tests for, so the behaviour is unchanged.

### Catalog deletes take their ratings with them

`ratings.entity_id` is polymorphic — 0001 kept it FK-free on purpose so episode
ratings could arrive without a migration — which means nothing cleaned up when
the row it pointed at went away. An `AFTER DELETE` trigger on `titles`, `seasons`
and `episodes` gives the cleanup the FK never could, and reaches `review_likes`,
`review_replies` and `notifications` through the existing cascade off `ratings.id`.

### Housekeeping picked up on the way past

Small, unrelated to each other, each cheap enough that leaving it would have
been the odd choice:

- **`handle_new_user` is idempotent.** It runs *inside* the `auth.users` INSERT,
  so a unique violation on `profiles.id` does not skip the profile — it aborts
  the whole signup, with an opaque "Database error saving new user". The FK from
  `profiles.id` means a row cannot pre-exist for a genuinely new user, so this
  is insurance rather than a live bug fix; the reachable way to hit it is the
  trigger firing twice for one row, which is what re-applying `0001` against a
  live database leaves behind.
- **`delete-account` pages past the first 100 avatars.** `storage.list` returns
  at most 100 entries and defaults to exactly that, with no error and no cursor,
  so a user who had changed their avatar more than 100 times left the rest
  behind: files owned by an account that no longer exists, which nothing will
  ever come back for. Each pass deletes the page it read, so the next page
  shifts to the front and there is no cursor to advance; the pass cap guards
  against a `remove` that reports success without removing anything.
- **`delete-account` clears the user's rate-limit buckets.** They are keyed by
  uid but deliberately carry no FK — the nil uuid stands in for the global
  buckets — so nothing cascades them. `rate_limits` is granted to `service_role`
  for `select, delete` only and to nobody else; inventing or topping up a bucket
  stays `consume_rate_limit`'s job.
- **Both functions stop handing internal errors to the client.** `String(err)`
  and a raw `error.message` are how a Postgres message or an upstream URL ends
  up in an alert on someone's phone. Unexpected failures are logged server-side
  and answered with a generic message — `502` from `tmdb-proxy` (the honest code
  when an upstream is what failed), `500` from `delete-account`. The deliberate,
  useful errors are untouched: `400` for a bad parameter, `409` for
  "not cached yet", `401` for "not authenticated".

## Consequences

- **Ordering is load-bearing, as always with this stack.** Migrations `0017` and
  `0018` must be applied **before** `tmdb-proxy` is deployed (it writes
  `imdb_checked_at` and calls `consume_rate_limit`), and the function must be
  deployed **before** the v1.16.1 build ships. **`delete-account` needs a deploy
  of its own** — it is the second function in the diff, and it reads
  `rate_limits`. That one is the forgiving step: out of order it logs the
  failed cleanup and deletes the account anyway.

  Every step is backward compatible with the step before it, so there is no
  window where a shipped client breaks.
- **Old clients are unaffected.** `imdb_checked_at` is a new column on a
  `select('*')` read; the 429 arrives as `{ error }`, which every shipped build
  already surfaces through `invoke()`. A client older than v1.16.1 keeps using
  the old backfill rule and so makes one extra edge call per unrated title —
  which the server answers from cache, without touching OMDb.
- **A denied request is now a possible state.** It was not before. `429` carries
  `Retry-After` and a human message; no client retries automatically, on
  purpose — the importer already has its own backoff and a second retry loop on
  top would fight it.
- **The `omdb` bucket is global, so one user's import can exhaust it for
  everyone** for a while. That is strictly better than the same import
  exhausting the *actual* quota for the rest of the day, which is what happened
  before, and the rating is not lost — it backfills on the next recheck.
- Not done here, deliberately: the write half of the viewer seam
  (`deleteMine`/`updateMine`), response-shape validation for `get_stats` and
  `get_feed`, and a query-key factory. They are separate changes with separate
  risk.
