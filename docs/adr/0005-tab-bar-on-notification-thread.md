# ADR 0005 — Keep the tab bar on the notification → thread flow (dual-route thread)

**Status:** superseded by [ADR 0006](0006-activity-feed-notifications-inbox.md) · 2026-07-22

> **Superseded (2026-07-23):** notifications no longer live behind a Library-header
> bell / `/notifications` screen — they moved into the top-level **Feed** tab
> (ADR 0006), so the notification → thread flow this ADR optimised no longer
> exists. A notification now taps through to the **root** `/review/[ratingId]`
> (covering the tab bar, like every other feed tap). The Library-nested
> `/thread/[ratingId]` route still exists but is no longer reached from a
> notification. The rest of this ADR is kept for historical context.

## Context

Detail screens (`title`, `user`, `review`, `notifications`) live at the **root
Stack**, as siblings of `(app)`. Because `(app)` hosts the native tab bar
(`expo-router/unstable-native-tabs`), any root-level detail screen **covers**
the tab bar. That's correct for most detail screens, but it made the
notification flow painful: bell → `/notifications` → tap a row →
`/review/[ratingId]`. Both are root screens, so returning to the Library meant
**Back, then Back again**, and from the thread you couldn't jump straight to
another tab. The thread also didn't surface the review's likes at all.

We want the **tab bar visible on the thread reached from a notification** — one
tap to any tab instead of two Backs. In expo-router v56, the tab bar only
persists over pushed screens when a `<Stack>` is **nested inside the tab**.

The catch: the same thread screen is also reached from a **title's review list**
(`ReviewRow` → `/review/[ratingId]`), which is itself a root screen. Pushing a
tab-stack screen *from* a root screen is a cross-navigator jump that produces
janky transitions and a wrong Back target. So a single shared route can't serve
both entries cleanly.

## Decision

- **Nest the Library tab as a Stack.** `(app)/(library)/` is a route **group**
  (URL-transparent) with its own `_layout.tsx` Stack. The Library screen
  (`index.tsx`) and `notifications.tsx` move inside it; URLs stay `/` and
  `/notifications`. The native-tab trigger `name` becomes `"(library)"`.
- **Dual route, one screen.** The thread body is extracted to
  `src/components/review-thread.tsx` (and the likers list to
  `review-likes.tsx`) and mounted by **two** thin routes:
  - **root** `/review/[ratingId]` (+ `/likes`) — covers the tab bar; pushed from
    a title's review list (`ReviewRow`).
  - **Library-nested** `/thread/[ratingId]` (+ `/likes`) — keeps the tab bar;
    pushed from a notification row.

  Each entry pushes within **its own** navigator, so Back is always correct. The
  shared component takes a `variant: 'root' | 'library'` that only decides which
  "Liked by" route it pushes; everything else (profile pushes to the root
  `/user/[id]`, the composer, the reply menu) is identical.
- **Likes on the thread card.** The header card now shows a heart + count
  mirroring `ReviewRow`: an optimistic toggle for others' reviews, a
  display-only counter (long-press → likers) for your own. Data comes from
  `getReviewThread`, extended with `likeCount` / `likedByMe` / `isMine` via
  count-only queries. (Shipped first as PR #23.)
- **Re-tap synergy.** `emitTabReset('library')` still fires on Library re-tap
  (PR #22); combined with the native tab's built-in pop-to-root, re-tapping
  Library from a notification/thread returns to the Library root.

## Consequences

- The thread has two URLs. Acceptable: they render the same component and the
  duplication is two ~8-line wrapper files, not logic.
- A cross-navigator push is avoided by construction — the price is the dual
  route rather than a single canonical one.
- Native tab behavior differs between iOS and Android, so this flow must be
  device-tested on **both** (tab bar present on notifications + thread; Back
  targets correct; title → review still covers the bar as before).
