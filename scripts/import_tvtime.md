# Import TV Time history into WatchBuddy

> **There is now an in-app importer.** Open **Edit Profile → Import your data →
> TV Time** in the app, pick your GDPR export ZIP, and it does everything below (with a
> manual-match step for titles it can't place) as the signed-in user — no
> service-role key needed. See ADR 0008. This CLI remains as the offline /
> power-user path; both are idempotent and interoperate.

A one-time migration script that reads your TV Time GDPR data export and
writes your watch history, rewatch counts, and library statuses into
WatchBuddy's Supabase backend.

**What gets imported**

| Data | Source file |
|---|---|
| Followed shows → library items (status inferred) | `followed_tv_show.csv` |
| Episodes seen per show (feeds the status) | `user_tv_show_data.csv` |
| Episode first-watches | `tracking-prod-records-v2.csv` |
| Rewatches (preserving count) | `rewatched_episode.csv` |
| Movie watches, rewatches and to-watch entries | `tracking-prod-records.csv` |
| Favorite shows and movies | `lists-prod-lists.csv` |

Ratings are not imported (TV Time's export format does not include numeric
values).

The script is **idempotent** — running it twice will not create duplicate watch
rows. It does **not** leave library statuses alone, though: see
[Library status mapping](#library-status-mapping).

---

## Prerequisites

- Python 3.11 or later
- A WatchBuddy account (any sign-in method)
- A TMDB account (free) with a v4 read-access token
- Access to your WatchBuddy Supabase project dashboard

---

## Step 1 — Export your TV Time data

1. Open TV Time → Profile → Settings → Privacy → **Request my data**
2. TV Time emails you a link within a few hours
3. Download and unzip the archive — you'll get a folder called `gdpr-data`
   containing dozens of `.csv` files

---

## Step 2 — Get a TMDB API key

1. Create a free account at <https://www.themoviedb.org>
2. Go to Settings → API → **Create → Developer**
3. Copy the **Read Access Token** (the long JWT). The short v3 API key works too.

---

## Step 3 — Get your Supabase service role key

1. Open your Supabase project dashboard
2. Go to **Settings → API**
3. Copy the **service_role secret** key

> **Warning:** the service role key bypasses Row-Level Security and has full
> database access. Never commit it to git. Add it only to your local `.env`
> which is already listed in `.gitignore`.

---

## Step 4 — Add credentials to `.env`

Open `.env` at the project root and append these lines:

```
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
TMDB_API_KEY=your-tmdb-v4-read-access-token
WATCHBUDDY_USER_ID=your-user-uuid
```

Find your user UUID in the Supabase dashboard under **Authentication → Users**.

`EXPO_PUBLIC_SUPABASE_URL` should already be present from your normal app setup.

---

## Step 5 — Install Python dependencies

```bash
pip install supabase python-dotenv requests
```

If you want to keep these isolated, use a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install supabase python-dotenv requests
```

---

## Step 6 — Run the script

From the project root:

```bash
python scripts/import_tvtime.py --gdpr-path /path/to/gdpr-data
```

Replace `/path/to/gdpr-data` with the actual path to the folder that contains
`followed_tv_show.csv`.

The script prints progress for every show and a summary at the end. A full
import of ~60 shows and ~3,000 episodes typically takes 2–5 minutes (mostly
TMDB API calls, which are rate-limited to stay under 50 req/s).

---

## Step 7 — Handle unresolved titles (if any)

A show is matched by its TVDB id first, then by name search on TMDB. Anything
that still can't be matched — shows and movies alike — is written to
`unresolved_shows.csv` in the current directory.

For each unresolved show:

1. Find it manually on <https://www.themoviedb.org> and note its TMDB TV id
2. Add it to `SHOW_OVERRIDES` at the top of `scripts/import_tvtime.py`
   (lowercased TV Time name → TMDB id)
3. Re-run the script — it skips what it already imported

An unresolved movie has no override; log it by hand in the app.

---

## Library status mapping

| TV Time signal | WatchBuddy status |
|---|---|
| `archived = true` | `dropped` |
| No episodes seen (the larger of `nb_episodes_seen` and the tracked watches) | `watchlist` |
| Show ended, seen ≥ total episodes | `completed` |
| Show ended, seen < total episodes | `on_hold` |
| Show still airing | `watching` |

Movies: a watch or rewatch sets `completed`; a to-watch entry sets
`watchlist`, unless the movie already has a watch on record.

The status is **upserted**: if WatchBuddy already has a `library_items` row for
the title, its status is replaced by the inferred one. Favorites are only ever
added, never removed.

---

## Troubleshooting

**`Missing env var: SUPABASE_SERVICE_ROLE_KEY`**
Add the key to `.env` as described in Step 4.

**`Not a directory: /path/to/gdpr-data`**
Make sure you're passing the path to the *folder*, not to a zip file.

**TMDB 401 errors**
`TMDB_API_KEY` is wrong or revoked. Either the v4 **Read Access Token** (a JWT
starting `eyJ`) or the v3 API key works; the script tells them apart.

**Slow / many TMDB calls**
The script fetches one TMDB page per season for every season that has watched
episodes. This is expected — the data is cached in Supabase so subsequent
app usage will be fast.
