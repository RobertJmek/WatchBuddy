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

One edge case by design: a title that has an `imdb_id` but for which OMDb
returns no rating will refetch on every view (it always looks "could backfill").
This is rare for real titles and is no worse than the pre-cache behavior.
