# ADR 0038 — Sharing a profile through a landing page

**Status:** accepted · app 1.32.0 + a static page on GitHub Pages, no backend change

## Context

Robert wanted a Share button on a profile that sends a short line and a link
that works on iOS and Android. The app's own scheme (`watchbuddy://user/<id>`)
is not a clickable link in many messaging apps and does nothing when the app is
not installed. Universal Links / Android App Links would open the app straight
from an `https://` link, but both need verification files at the **root** of a
domain (`/.well-known/`), and our Pages site lives under a path
(`robertjmek.github.io/WatchBuddy/`). iOS also needs the Associated Domains
capability on the signing account (Hagi's) and a new build.

## Decision

- **The shared link is `https://robertjmek.github.io/WatchBuddy/u/?id=<uuid>`**,
  served from `docs/u/index.html`. The uuid, not the username: a username can
  change, a shared link must keep working. **This URL shape is frozen** — every
  link anyone has sent points at it.
- **The page is static.** It accepts the id only if it is a UUID, makes no
  network calls and shows no profile data (no prod reads, nothing about the
  person leaks). It offers **Open in WatchBuddy** (`watchbuddy://user/<id>`) and
  the downloads: the App Store, and the GitHub APK while Play is in closed
  testing. No automatic redirect: Safari shows an error for an unknown scheme.
- **The button is on every profile you can see**, top right, hidden on one that
  is unavailable or blocked. It calls React Native's `Share.share` with the link
  inside `message` (Android's chooser ignores `url`).
  - Own: "Follow me on WatchBuddy to see what I'm watching."
  - Others: "Follow <name> on WatchBuddy to see what they're watching."
- **iOS uses native bar buttons** (`unstable_headerRightItems`,
  `sharesBackground: false`): a custom `headerRight` view put Share and ⋯ in one
  shared glass capsule on iOS 26. Android keeps the custom `headerRight`.

## Consequences

- Opening the app takes one tap on the page. A link opened while signed out lands
  on Welcome / Sign-in and the profile is not opened after signing in. Some
  in-app browsers (Instagram, TikTok) block custom schemes; the downloads still work.
- The page is live only once it is on `main` (Pages publishes `main`'s `docs/`),
  so it must merge before a build that shares it ships.
- Direct opening can be added later without changing the link: serve the same
  `/WatchBuddy/u/` path from a root domain with an AASA file and `assetlinks.json`,
  and add the associated domain and intent filter in a new build.
- Seen on the iPhone 17 Pro simulator (dark) and the Pixel 11 emulator: the
  buttons, the share sheet / chooser with the full text and link, and the page
  (served locally) opening the right profile in the app on both. After the
  merge the live URL returned 200, and opening it in the simulator's Safari
  led to the right profile. Not seen: a physical device, light mode on iOS.
