# tmdb-proxy

Server-side proxy + cache for TMDB. Keeps API keys off the client and upserts
fetched metadata into Postgres so statistics can run as SQL over the user's
library. Requires a valid Supabase JWT (`verify_jwt` stays on).

## Secrets

Set these on the deployed function (Dashboard → Edge Functions → `tmdb-proxy` →
Secrets, or `supabase secrets set KEY=value`). `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

| Secret | Required | Purpose |
|---|---|---|
| `TMDB_API_KEY` | **yes** | TMDB v4 read-access token (Bearer). All metadata. |
| `OMDB_API_KEY` | no | Enables IMDb rating numbers (see below). |
| `TITLE_CACHE_TTL_HOURS` | no | How long a cached title is served before refetch. Default `168` (7 days). |
| `IMDB_RECHECK_HOURS` | no | How long a fruitless OMDb lookup is remembered before asking again. Default `24`. |

## Enabling IMDb ratings

IMDb has no official public API; the standard source for IMDb rating numbers is
[OMDb](https://www.omdbapi.com/), keyed by `imdb_id` (which TMDB gives us). The
schema column (`titles.imdb_rating`), the fetch (`imdbRating()`), the write, and
the UI pill (`IMDb 8.4` on the title screen) are all already in place — the only
switch is the key.

1. Get a free key at <https://www.omdbapi.com/apikey.aspx> (instant by email;
   free tier is **1,000 requests/day**).
2. `supabase secrets set OMDB_API_KEY=<key>`
3. Redeploy: `supabase functions deploy tmdb-proxy`

Existing cached titles backfill their rating the next time they're opened: the
cache gate forces a refetch for any row that has an `imdb_id` but no
`imdb_rating` while the key is set. After that the rating is cached and served
until the TTL expires.

## Caching

`handleTitle` serves a cached row directly when it's younger than
`TITLE_CACHE_TTL_MS` (from `TITLE_CACHE_TTL_HOURS`), skipping both the TMDB and
OMDb round-trips. This is what keeps OMDb usage well under the 1,000/day free
limit — without it, every title view spent one OMDb request.

A title that has an `imdb_id` but for which OMDb has **no** rating used to defeat
that cache entirely: it always looked like it "could backfill", so every view
refetched from TMDB *and* spent another OMDb request, forever. `titles.imdb_checked_at`
(migration `0017`) records when OMDb was last asked, whether or not it answered,
and the gate re-asks only after `IMDB_RECHECK_HOURS`. `src/lib/tmdb.ts` mirrors
the same rule client-side.

## Rate limiting

Every call spends from a token bucket stored in Postgres (`rate_limits` +
`consume_rate_limit`, migration `0018`) before it is dispatched. Buckets are in
the database and not in the isolate because an isolate has no memory across
bursts and several run at once.

| bucket | subject | capacity | refill | covers |
|---|---|---|---|---|
| `tmdb-proxy` | caller's uid | 300 | 40/s | upstream TMDB requests, per signed-in user |
| `tmdb-proxy` | nil uuid | 30 | 1/s | callers presenting only the anon key |
| `omdb` | nil uuid | 100 | 700/day | OMDb's global 1,000/day quota |

Cost is the worst-case number of upstream requests an action makes: `search` 3,
bare `trending` 2, everything else 1. The per-user ceiling is sized off the TV
Time importer — the heaviest legitimate client — so a real import never feels it.

Over budget returns **429** with `Retry-After` and a human message. Running the
`omdb` bucket dry is not an error: the title loads without its IMDb rating and
the lookup is retried after `IMDB_RECHECK_HOURS`. If the limiter itself fails,
the request is allowed through and the failure is logged.

Tuning capacity or refill is a **function deploy**, not a migration — both are
passed per call.

## Validation

Parameters are validated before they reach a URL or a query: `media_type` must
be `movie` or `tv`, `tmdb_id` / `season_number` / `page` must be whole numbers in
range, `external_id` must be alphanumeric, `q` is length-capped. Unexpected
failures are logged server-side and answered with a generic message — an
upstream URL or a Postgres error must not end up in an alert on someone's phone.

Calling `trending` with **no** `media_type` remains valid and returns
`{ movies, tv }`: that is the shape every client through v1.15.0 parses, and an
edge deploy reaches all of them at once.
