# WatchBuddy 🎬

A cross-platform mobile app to track the movies and TV series you watch, turn that
history into rich statistics, and follow what your friends are watching and rating.
Built personal-core-first on a social-ready foundation, with a future path to
importing your history from TV Time.

> React Native + Expo + Supabase. iOS and Android from one codebase.

---

## Features

### Discover
- **Live search-as-you-type** across movies and TV (TMDB), backed by a server-side cache.
- **Trending this week** feed shown by default on the Search tab as horizontal poster shelves.
- **People search:** type `@` to find other users by username or name, and follow them.
- Full **title detail** — poster, overview, TMDB / IMDb / WatchBuddy ratings, and seasons/episodes.

### Track
- **Library** grouped by status — watchlist / watching / completed / on-hold / dropped —
  laid out as poster shelves, each expandable into a full grid.
- **Favorites** — heart any movie or show; dedicated favorite shelves for movies and TV.
- **Episode-level check-off**, with **rewatch logging per episode, per season, and per series**.
- **Movie watch logging** (rewatches included).
- A dated **Diary** of everything you've watched, filterable by **day / week / month / year /
  custom range**.
- **10-point ratings with optional reviews** for movies and shows.

### Statistics (its own tab)
- Hero totals — total time watched, this-year totals, titles / movies / episodes.
- **Trends** — last-12-months activity and watch **patterns** (busiest weekday, biggest day,
  current & longest streaks, busiest month).
- **Top people** — most-watched directors and actors.
- **Taste insights** — average rating by genre, highest rated, most rewatched.
- **Breakdowns** — genre, decade, language, movie/TV split, library status, and top networks.

### Social & community
- **Asymmetric follow** — follow anyone instantly; see follower / following counts and lists.
- **Public profiles** (`/user/[id]`) — avatar, bio, follower counts, a compact stats summary,
  and recent activity.
- **Community ratings per title** — an aggregate **WatchBuddy score** (mean + count) shown
  beside the TMDB/IMDb badges.
- **Community reviews** — read everyone's written reviews on a title, with **people you follow
  surfaced first**; preview on the detail screen and a full `See all` reviews screen.

### Account & platform
- **Auth** — passwordless email one-time code, plus Google sign-in (OAuth).
- **Editable profile** — display name, unique username, bio, and avatar upload.
- **Appearance** — light / dark / system theme toggle (persisted), teal accent throughout.
- **Offline** — read data (Library / Diary / Stats / profiles) is cached and persisted, so the
  app cold-opens and browses offline.

---

## Tech stack

| Layer | Choice |
|---|---|
| App | React Native + Expo (Expo Router, file-based routes), TypeScript |
| Data / cache | TanStack Query with AsyncStorage persistence (instant cold-open) |
| Backend | Supabase — Postgres with Row-Level Security, Auth, Storage |
| Metadata | TMDB (primary) + optional OMDb fallback for IMDb ratings |
| TMDB access | A Supabase **Edge Function** (`tmdb-proxy`) that hides API keys and caches metadata into Postgres so **stats run as SQL aggregations**, not live API fan-out |

**Data model (Postgres):** a shared catalog cache (`titles`, `seasons`, `episodes`, `genres`,
`people`, `credits`, `networks`) plus per-user, RLS-isolated data (`profiles`, `follows`,
`library_items`, `episode_watches`, `movie_watches`, `ratings`). Watch data is readable by any
signed-in user (public-diary model); writes stay owner-only.

---

## Project structure

```
src/
  app/                     Expo Router routes
    (app)/                 Authenticated tabs: Library, Search, Stats, Profile
    title/[id]/            Title detail (index) + community reviews
    user/[id]/             Public profile (index) + followers / following
    season, diary, edit-profile, library-section, sign-in
  components/              Reusable UI (poster shelf, watch bars, rating/review rows,
                           follow button, user row, …)
  lib/                     supabase client, query client, TMDB client, and data modules
                           (library, watches, ratings, stats, social, profile, …)
supabase/
  migrations/              SQL schema + RLS (0001 init, 0002 favorites, 0003 avatars,
                           0004 follows + public reads)
  functions/               Edge Functions (tmdb-proxy)
```

---

## Getting started

### Prerequisites
- Node.js + npm
- Xcode (iOS) / Android Studio (Android) for a development build
- A Supabase project and a TMDB API token

### 1. Install
```bash
npm install
```

### 2. Configure environment
Copy the example env file and fill in your Supabase values (Settings → API). These are safe for
the client; **never** put the `service_role` or any secret key here.
```bash
cp .env.example .env
```
```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

### 3. Set up the backend
- Apply the migrations in `supabase/migrations/` **in order** (Supabase SQL Editor or CLI):
  `0001_init` → `0002_favorites` → `0003_avatars` → `0004_follows`.
- Set the Edge Function secret and deploy:
  ```bash
  supabase secrets set TMDB_API_KEY='<your-tmdb-token>' --project-ref <ref>
  supabase functions deploy tmdb-proxy --project-ref <ref>
  ```
  (Optional: also set `OMDB_API_KEY` to enable IMDb ratings.)

### 4. Run
A **development build** is required (OAuth deep links and native modules don't work in Expo Go):
```bash
npx expo run:ios       # or: npx expo run:android
```

> **Heads-up for contributors:** after moving an Expo Router file into a directory
> (e.g. `foo/[id].tsx` → `foo/[id]/index.tsx`), run `npx expo export --clear` — a stale
> Metro cache otherwise throws a spurious `package.json does not exist` error.

---

## Verify it works
```bash
npx tsc --noEmit                 # type-check
npx expo export --platform ios   # bundle without a device
```

---

## Status

v1 personal core is complete — tracking, a full statistics tab, offline read cache, and email +
Google auth — on a teal light/dark design. The **social layer** is live: user search, follows,
public profiles, and community ratings/reviews per title.

**Planned next:** Apple sign-in and the TV Time CSV importer.
