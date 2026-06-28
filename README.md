# WatchBuddy 🎬

A cross-platform mobile app to track the movies and TV series you watch and turn
that history into rich statistics. Built personal-core-first on a social-ready
foundation, with a future path to importing your history from TV Time.

## Features (v1)

- **Search & catalog** — search movies and TV via TMDB, with full detail (poster,
  ratings, seasons/episodes), backed by a server-side cache.
- **Tracking**
  - Library statuses: watchlist / watching / completed / on-hold / dropped.
  - Episode-level check-off, with **rewatch logging per episode, per season, and
    per series**.
  - Movie watch logging (with rewatches).
  - A dated **diary** of everything you've watched.
  - **10-point ratings** with optional reviews (movies & shows).
- **Statistics** — total time watched, this-year totals, last-12-months trend,
  ratings distribution, and breakdowns by genre, decade, and language.
- **Auth** — passwordless email one-time code, plus Google sign-in (OAuth).
- **Offline** — read data (Library / Diary / Stats) is cached and persisted, so
  the app cold-opens and browses offline.

## Tech stack

- **App:** React Native + Expo (Expo Router), TypeScript.
- **Data/cache:** TanStack Query with AsyncStorage persistence.
- **Backend:** Supabase — Postgres (with Row-Level Security), Auth, and an Edge
  Function (`tmdb-proxy`) that proxies TMDB/OMDb and caches metadata into Postgres
  so statistics run as SQL aggregations.
- **Metadata:** TMDB (primary) with an optional OMDb fallback for IMDb ratings.

## Project structure

```
src/
  app/            Expo Router routes
    (app)/        Authenticated tabs: Library, Search, Profile
    title/[id]    Title detail
    season, diary, stats, sign-in
  components/      Reusable UI (status bar, watch bars, rating bar, …)
  lib/            supabase client, query client, data modules, TMDB client
supabase/
  migrations/     SQL schema + RLS
  functions/      Edge Functions (tmdb-proxy)
```

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

Copy the example env file and fill in your Supabase project values
(Settings → API). These are safe for the client; never put the `service_role`
or secret API key here.

```bash
cp .env.example .env
```

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

### 3. Set up the backend

- Apply the schema: run `supabase/migrations/0001_init.sql` in the Supabase SQL
  Editor (or via the Supabase CLI).
- Set the Edge Function secret and deploy:

  ```bash
  supabase secrets set TMDB_API_KEY='<your-tmdb-token>' --project-ref <ref>
  supabase functions deploy tmdb-proxy --project-ref <ref>
  ```

  (Optional: also set `OMDB_API_KEY` to enable IMDb ratings.)

### 4. Run

A **development build** is required (the OAuth deep link and native modules don't
work in Expo Go):

```bash
npx expo run:ios       # or: npx expo run:android
```

## Status

v1 core is implemented (tracking, stats, offline read cache, email + Google auth).
Planned next: Apple sign-in, the TV Time CSV importer, and a visual design pass.
