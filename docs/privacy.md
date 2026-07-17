# WatchBuddy — Privacy Policy

_Last updated: 17 July 2026_

WatchBuddy is a personal movie & TV tracking app. This page explains what data
the app handles and how.

## What we collect

- **Account**: your email address (used only to sign you in) and, if you use
  Google sign-in, the email Google shares with us.
- **Profile**: the display name, username, bio and avatar you choose to set.
- **Your activity in the app**: library statuses, watch history, ratings,
  reviews, favorites and follows. This is the product — it exists so the app
  can show it back to you and, where the feature is social by design (public
  profiles, community ratings), to other signed-in users.

## What we don't do

- No ads and no tracking or analytics SDKs.
- No selling or sharing of personal data with third parties.
- No access to your contacts, location, microphone or photos (except the photo
  you explicitly pick as an avatar).

## Where data lives

Data is stored in [Supabase](https://supabase.com) (Postgres + storage),
encrypted in transit (HTTPS). Movie/TV metadata comes from
[TMDB](https://www.themoviedb.org) — search queries are proxied through our
backend and are not tied to your identity by TMDB.

## Deleting your data

You can permanently delete your account and all associated data at any time
from **Profile → Delete account** inside the app. See
[account deletion](delete-account.md) for details and an email fallback.

## Contact

Questions or requests: open an issue at
[github.com/RobertJmek/WatchBuddy](https://github.com/RobertJmek/WatchBuddy/issues).
