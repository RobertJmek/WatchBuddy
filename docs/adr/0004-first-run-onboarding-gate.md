# ADR 0004 — First-run onboarding gate (username + avatar)

**Status:** accepted · 2026-07-21

## Context

A freshly signed-up user gets a `profiles` row created by the `handle_new_user`
trigger (`0001_init.sql`) with `username = NULL` and `display_name` set to the
OAuth name or — on email sign-up — the raw email address. Nothing then prompts
them to set a username or photo, so most new accounts stay **unfindable**: user
search matches on username/display name, and other people can't follow a diary
they can't locate. We want to *suggest* (not force) completing these right after
the first sign-in.

## Decision

- **A dedicated route, `src/app/onboarding.tsx`**, seeded from the auto-created
  profile (pre-fills the display name so an email-derived one can be replaced).
  It reuses the existing profile layer verbatim — `getMyProfile`,
  `uploadAvatar`, `updateProfile`, `UsernameTakenError`, and the same
  `USERNAME_RE` (`/^[a-z0-9_]{3,20}$/`) and `pickAvatar` flow as
  `edit-profile.tsx`. No new data layer.
- **Suggested, not mandatory.** The screen leads with copy explaining that a
  username + photo let friends find and follow you, but offers **"Skip for
  now"**. Username stays optional everywhere; if provided it must be valid/free.
- **Gate lives in `src/app/(app)/_layout.tsx`**, where the authed tabs mount
  (the first signed-in screen). When the cached `['profile']` query resolves
  with `username == null` and onboarding hasn't been seen, it
  `router.replace('/onboarding')`. A `useRef` guards against a double-push on
  refetch.
- **"Seen" is remembered per user, client-side** (`src/lib/onboarding.ts`,
  AsyncStorage key `wb:onboarding-seen:<uid>`). Set on both Continue and Skip.
  Keyed by user id so a second account on the same device gets its own run and
  signing out never re-triggers it.

## Consequences

- Shows **once**: skipping is respected (flag set) and a set username also
  closes the gate, so there's no nag loop. A user who skips can still set a
  username later from Edit Profile.
- The gate reads a query that's persisted (TanStack + AsyncStorage), so
  returning users with a username set see no flash or redirect.
- "Seen" being local means it doesn't survive a reinstall / new device — an
  acceptable trade for not adding a server column. If we later want it
  server-side, add a `profiles.onboarded_at` and swap the storage helper.
- Route registered under the signed-in guard in the root `_layout.tsx` with
  `gestureEnabled: false` so the user can't swipe back into a half-mounted tab
  state during the redirect.
