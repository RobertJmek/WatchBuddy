# WatchBuddy — Privacy Policy

_Last updated: 8 November 2026_

WatchBuddy is a personal movie & TV tracking app. This page explains what data
the app handles and how.

## What we collect

- **Account**: your email address (used only to sign you in) and, if you use
  Google or Apple sign-in, the email that provider shares with us (with Apple,
  this can be a private relay address).
- **Profile**: the display name, username, bio and avatar you choose to set.
  Until you pick a display name you get a random one (like "Sleepy Usher 512"),
  or the name Google shares with us; your email is never used as your name.
  Your profile is visible to other signed-in users, and your avatar image is
  served from a public link.
- **Your activity in the app**: library statuses, watch history, ratings,
  reviews, favorites and follows. This is the product — it exists so the app
  can show it back to you and, where the feature is social by design (public
  profiles, community ratings), to other signed-in users.
- **Blocks and reports**: the people you have blocked (nobody else sees your
  list; someone you block sees that your profile isn't available to them, so
  they may work out that you blocked them) and the reports you file about a
  review, reply or profile — the reason you picked, visible only to us. Reports
  are kept so we can act on them.
- **Usage limits**: a request counter tied to your account id (a number and a
  timestamp), so one account can't exhaust the movie database for everyone. It
  is deleted with your account.

## What we don't do

- No ads and no tracking or analytics SDKs.
- No selling or sharing of personal data with third parties.
- No access to your contacts, location, microphone or photos (except the photo
  you explicitly pick as an avatar).

## Where data lives

Data is stored in [Supabase](https://supabase.com) (Postgres + storage),
encrypted in transit (HTTPS). Movie/TV metadata comes from
[TMDB](https://www.themoviedb.org): search queries and title lookups go through
our backend, so TMDB never sees who asked. Posters and backdrop images are
loaded by your device straight from TMDB's image servers, which see your IP
address like any website you open. IMDb ratings come from
[OMDb](https://www.omdbapi.com); our backend asks it about a title by IMDb id
only, with nothing about you.

## Deleting your data

You can permanently delete your account and all associated data at any time
from **Profile → Edit Profile → Delete account…** inside the app. Your blocks and
the reports you filed are deleted with it. See [account deletion](delete-account.md)
for details and an email fallback. You can also download a copy of your data
first, from **Edit Profile → Export your data**.

## Contact

Questions or requests: email **bunescurobert16@gmail.com**. For bugs and feature requests you can also
open an issue at
[github.com/RobertJmek/WatchBuddy](https://github.com/RobertJmek/WatchBuddy/issues)
(it is public, so leave personal details out).
