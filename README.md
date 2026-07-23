# WatchBuddy 🎬

A cross-platform mobile app to track the movies and TV series you watch, turn that
history into rich statistics, and follow what your friends are watching and rating.
Built personal-core-first on a social-ready foundation, with a ready-to-use importer
for your TV Time history.

> React Native + Expo + Supabase. iOS and Android from one codebase.

---

## 📲 Download (Android)

Install the latest Android build directly — no Play Store needed:

### [⬇️ Download the APK](https://github.com/RobertJmek/WatchBuddy/releases/latest/download/watchbuddy-android-arm64.apk) &nbsp;·&nbsp; ~45 MB

1. Open that link **on your Android phone** and download the file.
2. Tap it; if prompted, allow your browser/Files app to *install unknown apps*.
3. If Play Protect warns it wasn't scanned, choose **More details → Install anyway** — normal for
   apps installed outside the Play Store.

Runs on any 64-bit Android phone (~2017 and newer); no account, no expiry. The link always points
to the newest [release](https://github.com/RobertJmek/WatchBuddy/releases/latest). iOS isn't
distributed this way — Apple requires installs via Xcode or TestFlight (see
[Run on a physical device](#run-on-a-physical-device)).

---

## Features

### Discover
- **Live search-as-you-type** across movies and TV (TMDB), backed by a server-side cache;
  results span multiple TMDB pages for deep matches.
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
  custom range**, with **editable watch dates** (grouped episode entries move together).
- **Search inside Library and Diary** — a toggleable title search that composes with the
  existing status/period filters.
- **10-point ratings with optional reviews** for movies and shows — **edit or delete your own
  review** anytime from its page (deleting keeps your score, just clears the text).

### Statistics (from your profile)
- Hero totals — total time watched, this-year totals, titles / movies / episodes.
- **Trends** — last-12-months activity and watch **patterns** (busiest weekday, biggest day,
  current & longest streaks, busiest month).
- **Top people** — most-watched directors and actors.
- **Taste insights** — average rating by genre, highest rated, most rewatched.
- **Breakdowns** — genre, decade, language, movie/TV split, library status, and top networks.

### Social & community
- **Activity feed** (its own tab) — a reverse-chronological stream of what the people you
  follow do: watches, ratings, reviews, follows, and review likes/replies (binge episodes
  collapse into one "watched N episodes" row). It doubles as an **inbox**: your own
  notifications (likes/replies on your reviews) pin to the top, and friends' activity shows
  unseen-first — unseen items stay until you've seen them, then age out ~24h after you've
  seen them.
- **In-app notifications** — likes and replies on your reviews, delivered live over Supabase
  Realtime; surfaced pinned atop the feed with an unread badge on the tab.
- **Asymmetric follow** — follow anyone instantly; see follower / following counts and lists.
- **Public profiles** (`/user/[id]`) — avatar, bio, follower counts, a compact stats summary,
  a **taste summary** (top genres + favorite directors), and **Watching now / Favorites /
  Recently completed** shelves alongside recent activity.
- **Community ratings per title** — an aggregate **WatchBuddy score** (mean + count) shown
  beside the TMDB/IMDb badges.
- **Community reviews** — read everyone's written reviews on a title, with **people you follow
  surfaced first**; preview on the detail screen and a full `See all` reviews screen.

### Account & platform
- **Auth** — passwordless email one-time code, plus Google sign-in (OAuth).
- **First-run onboarding** — new accounts are gently prompted to set a username and photo so
  friends can find and follow them; skippable and shown once.
- **Editable profile** — display name, unique username, bio, and avatar upload.
- **Appearance** — light / dark / system theme toggle (persisted), teal accent throughout.
- **Offline** — read data (Library / Diary / Stats / profiles) is cached and persisted, so the
  app cold-opens and browses offline.
- **Polish** — press/entry animations and skeleton loading states across all screens.

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
    (app)/                 Authenticated tabs: Feed, Library, Search, Profile
    title/[id]/            Title detail (index) + community reviews
    user/[id]/             Public profile (index) + followers / following
    season, diary, stats, edit-profile, library-section, sign-in
  components/              Reusable UI (poster shelf, watch bars, rating/review rows,
                           follow button, user row, …)
  lib/                     supabase client, query client, TMDB client, and data modules
                           (library, watches, ratings, stats, social, profile, …)
scripts/                   TV Time importer (import_tvtime.py + docs) and app-icon generator
supabase/
  migrations/              SQL schema + RLS, applied in order (0001 init, 0002 favorites,
                           0003 avatars, 0004 follows + public reads, 0005 episode cache,
                           0006 review likes, 0007 review replies, 0008 notifications,
                           0009 activity feed, 0010 feed seen-watermark,
                           0011 feed seen-window)
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
  `0001_init` → `0002_favorites` → `0003_avatars` → `0004_follows` →
  `0005_episodes_cached_at` → `0006_review_likes` → `0007_review_replies` →
  `0008_notifications` → `0009_feed` → `0010_feed_seen` → `0011_feed_seen_window`.
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
This installs a debug build that loads its JavaScript from the Metro dev server
(`npx expo start`), so during development the device must reach your machine over the network.

#### Run on a physical device
- **iPhone (free Apple ID):** plug in over USB and set your signing team once in Xcode
  (`open ios/WatchBuddy.xcworkspace` → target → *Signing & Capabilities* → *Automatically manage
  signing*), then `npx expo run:ios --device`. A free Apple ID works, but the install expires
  after ~7 days — re-run to refresh. First launch needs the profile trusted under
  *Settings → General → VPN & Device Management*.
- **Android:** enable *USB debugging*, plug in, then `npx expo run:android`. Requires the Android
  SDK; if `adb`/Gradle can't be found, export `ANDROID_HOME` (e.g. `$HOME/Library/Android/sdk`)
  and add its `platform-tools` to `PATH`.

#### Standalone install (no Metro, no computer)
A release binary bundles the JS inside the app, so it runs entirely on its own — it only needs
internet to reach Supabase/TMDB, not your Mac:
```bash
# Android — a sideloadable APK (debug-keystore signed; fine for personal use, not Play-Store-ready)
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk   (install: adb install -r <apk>)

# iOS — a standalone Release build installed over the cable (free Apple ID: same ~7-day expiry)
npx expo run:ios --configuration Release --device
```
> iOS has no freely-sideloadable equivalent of an APK. iOS builds ship through
> **TestFlight** (EAS cloud build signed with a distribution certificate; 90-day builds).
> The signing credentials and pipeline notes live outside the repo.

> **Gradle 9 / Android builds:** React Native pins an old `foojay-resolver-convention` plugin that
> breaks on the Gradle 9 wrapper it ships (`JvmVendorSpec … IBM_SEMERU`). A `patch-package` patch
> in `patches/` bumps it and is applied automatically on `npm install` via the `postinstall`
> hook — no action needed.

> **Heads-up for contributors:** after moving an Expo Router file into a directory
> (e.g. `foo/[id].tsx` → `foo/[id]/index.tsx`), run `npx expo export --clear` — a stale
> Metro cache otherwise throws a spurious `package.json does not exist` error.

---

## Import your TV Time history

A Python script imports your TV Time GDPR export — followed shows (with inferred statuses),
every episode watch, rewatches, movie watches, and favorites — matching titles to TMDB and
skipping anything already imported (safe to re-run). It runs against your own Supabase project
using `SUPABASE_SERVICE_ROLE_KEY`, `TMDB_API_KEY`, and `WATCHBUDDY_USER_ID` env vars.
See **[`scripts/import_tvtime.md`](scripts/import_tvtime.md)** for the full walkthrough.

---

## Verify it works
```bash
npx tsc --noEmit                 # type-check
npx expo export --platform ios   # bundle without a device
```

---

## Status

The personal core is complete — tracking, library/diary search, editable watch dates, a full
statistics tab, offline read cache, and email + Google auth — on a teal light/dark design.
The **social layer** is live: user search, follows, rich public profiles (taste summary +
shelves), community ratings/reviews per title, **threaded review replies**, **realtime
in-app notifications** (reply + like activity, delivered over Supabase Realtime), and a
**following activity feed** that folds those notifications into an inbox on its own tab. The
**TV Time importer** has shipped. Title screens serve from a **read-through Postgres cache**
with stale fallbacks and request timeouts, so browsing stays fast and keeps working even when
TMDB is down.

**Distribution:** Android ships as a free sideload APK (GitHub releases) and is in **Google Play
closed testing**; iOS ships via **TestFlight**.

**Planned next:** finish Play closed testing → production, a PRO tier (ad-free) with AdMob
banners, Apple sign-in, and over-the-air updates (EAS Update).
