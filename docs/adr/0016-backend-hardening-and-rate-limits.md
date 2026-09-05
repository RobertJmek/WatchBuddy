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

Because that reasoning rests entirely on `verify_jwt`, it is now **pinned in
`supabase/config.toml`** (`[functions.tmdb-proxy] verify_jwt = true`, and the
same for `delete-account`) rather than left to the CLI default and a dashboard
toggle. A behaviour this depends on should be a line in the repo, not a setting
someone has to remember. With it off, anyone could mint a token with an
arbitrary `sub`, take a fresh per-user budget on every request, and reach the
proxy unauthenticated besides.

### Running out of OMDb budget degrades, it does not fail

The title still loads, without its IMDb rating.

With one rule attached: **only an actual answer from OMDb may change the stored
value.** A lookup that produced no answer leaves whatever rating the row already
had. An answered lookup that returns nothing still clears it — that is the case
where "no rating" is the truth.

Getting that right needs `imdbRating()` to return **three** things, not two:

| result | meaning |
|---|---|
| a number | the rating |
| `null` | OMDb answered, and has no rating for this title |
| `undefined` | no answer — network error, HTTP error, or an OMDb error body |

**The first cut of this shipped with only two**, and the rule was enforced only
on the path where our own bucket refused. `imdbRating()` returned `null` for a
network failure and for OMDb's own `{"Response":"False","Error":"Request limit
reached!"}` (whose missing `imdbRating` parsed to `NaN`) exactly as it did for a
genuine "no rating". So on the weekly TTL refresh of an already-rated title,
one transient failure deleted the rating — and `imdb_checked_at`, added in the
same change, then hid the loss until the next recheck window. Caught in review;
the fix is above.

An unanswered lookup is stamped with a **shorter** window (`IMDB_RETRY_MINUTES`,
default 60) than an answered one. A full 24h would mean a busy hour costs a
title its rating for a day, and an import of a few hundred cold titles leaves
most of them waiting on a bucket that refills far sooner. Not stamping at all
would reopen the cache-defeating loop the stamp exists to close. The stamp is
back-dated by the difference, so both gates — here and the mirror in
`src/lib/tmdb.ts` — come due early without needing a second column or a client
that knows about it.

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

### Postscript: the lock 0018 didn't achieve

`0018` shipped with `consume_rate_limit` callable by **anon**, and prod confirmed
it. `revoke all on function … from public` drops only the implicit grant every
function is created with; Supabase separately runs `alter default privileges in
schema public grant all on functions to anon, authenticated, service_role`, so
the function was created with an **explicit** grant to those roles that a
PUBLIC-targeted revoke leaves alone. The same migration got the *table* right,
naming the roles — the inconsistency was the bug.

Because the anon key is embedded in the app and public, anyone could have called
the RPC directly and drained any bucket (the global `omdb` one included) or
inserted unbounded rows, since bucket and subject are caller-supplied. It touches
no table but `rate_limits`, so nothing was exposed; the damage would have been to
the budget the buckets exist to protect. `0019` revokes by name.

It survived review because the local harness didn't have Supabase's default
privileges, so the revoke looked sufficient there. **A privilege test is only
worth the fidelity of the roles it runs against** — the harness now sets the
same `alter default privileges` the platform does, and reproduces the hole
before the fix and denies it after.

Probing this without writing to production is worth remembering too: calling the
RPC with `p_cost = 0` hits the guard clause before any insert, so an authorised
caller gets the function's own `P0001` and an unauthorised one gets `404`. The
first check for it was a plain call, which did reach the insert.

### Verified against production

> **Superseded in part.** The table below was measured against the first deploy.
> The OMDb tri-state fix and the pinned `verify_jwt` landed after it, so
> `tmdb-proxy` needs a **redeploy**; the rate-limit and validation rows are
> unaffected by that change and still hold.


Migrations `0017`–`0019` applied and both functions deployed, 2026-09-05. What
prod actually answers, with the anon key:

| check | result |
|---|---|
| anon → `consume_rate_limit` | `42501 permission denied for function`, HTTP 401 (was: the function's own `P0001`, HTTP 400 — i.e. anon reached the body) |
| bare `{action:'trending'}` | `{ movies: 20, tv: 20 }` — the frozen shape is intact, and the call succeeding proves `service_role` kept its grant |
| `media_type: "../../secret"` | `400 media_type must be movie or tv` |
| 60 parallel calls into the anon bucket | **32 allowed / 28 refused** — capacity 30 plus ~2 refilled mid-burst |
| one refused response | `HTTP 429`, `retry-after: 1`, `{"error":"Too many requests. Try again in 1s."}` |
| the same call six seconds later | through — the bucket refills on its own |

The fourth row is the one that mattered. Spending **fails open**, so a limiter
that had silently lost its grant would look exactly like a working app: every
earlier check would still have passed. The only way to tell the two apart is to
run the bucket dry and watch it refuse.

Probed with `action: 'season'` on a valid-but-uncached `tmdb_id`, which clears
validation, spends its token, and then returns `409` without a single upstream
request — so the bucket can be exhausted without generating any TMDB traffic.

## Consequences

- **Ordering is load-bearing, as always with this stack.** Migrations `0017`
  through `0019` must be applied **before** `tmdb-proxy` is deployed (it writes
  `imdb_checked_at` and calls `consume_rate_limit`), and the function must be
  deployed **before** the v1.16.1 build ships. **`delete-account` needs a deploy
  of its own** — it is the second function in the diff, and it reads
  `rate_limits`. That one is the forgiving step: out of order it logs the
  failed cleanup and deletes the account anyway.

  **`0019` is not optional and not cosmetic.** Without it the RPC is callable
  with the app's public anon key and the limiter is bypassable by anyone — a
  deploy of `tmdb-proxy` onto `0018` alone gives the *appearance* of rate
  limiting and none of it. It is a plain `revoke`, so it is safe to apply at any
  time, including after the fact (which is what happened here).

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
- **Left out on purpose, named so they are not lost.** The first three came out
  of the same audit as this pass and were sequenced after it; the rest surfaced
  while reviewing it:
  - the write half of the viewer seam (`deleteMine`/`updateMine` for six
    mutations that delete/update without `user_id`, leaning on RLS alone);
  - response-shape validation for the `get_stats` and `get_feed` RPCs — the
    same class of bug that poisoned the persisted cache on the Hot section;
  - a query-key factory;
  - **indexes on the FK side of the cascade deletes.** Cheap, and
    `delete-account` leans entirely on those cascades — an account with a lot
    of history is the slow case nobody has measured;
  - **`handleSeason` still answers `409 Title not cached yet`**, which the
    client surfaces to the user as-is. It is a control-flow signal wearing an
    error's clothes; left alone here because changing it is a client change
    too, and this pass was deliberately server-only;
  - **`get_stats` takes `p_user_id` from the caller.** Reads are world-open so
    nothing leaks, but the parameter is trusted rather than derived, which is
    the shape the viewer seam exists to avoid;
  - **two simultaneous cold requests for the same title spend two OMDb
    tokens.** There is no in-flight coalescing, so a burst on an uncached title
    double-charges the global budget. Bounded and rare; worth knowing before
    the budget is tuned down.
