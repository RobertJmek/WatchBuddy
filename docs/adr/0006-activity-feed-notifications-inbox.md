# ADR 0006 — Following activity feed as a read-time fan-out, with notifications folded in as an inbox

**Status:** accepted · 2026-07-23

## Context

Until now WatchBuddy had no home for "what are the people I follow doing" — you
had to visit each profile. Separately, activity on *your own* reviews (likes /
replies) surfaced through a Library-header **bell** + a `/notifications` screen
(see the now-superseded [ADR 0005](0005-tab-bar-on-notification-thread.md)).

We want a single **Feed** tab that shows friends' activity, and we want personal
notifications to live there too rather than in a separate corner of the app.

Two design axes had real trade-offs:

1. **How is the feed data produced?** Friends' activity is spread across six
   tables (`episode_watches`, `movie_watches`, `ratings`, `follows`,
   `review_likes`, `review_replies`). The classic options are **fan-out-on-write**
   (a materialised `feed_events` table kept up to date by triggers — fast reads,
   duplicated data, more moving parts, live-updatable) versus
   **fan-out-on-read** (query the source tables on demand — no duplication, no
   triggers, heavier query).

2. **What does the feed show over time?** A persistent chronological timeline, or
   an **inbox** that surfaces unseen things and clears what you've already seen.
   The inbox needs a notion of "seen", but feed events are *synthetic* (they come
   out of a `UNION`, so there's no per-event row to stamp).

## Decision

- **Fan-out-on-read.** A single RPC `public.get_feed(p_limit, p_before)`
  (`SECURITY INVOKER`) `UNION ALL`s the six source tables, scoped to the viewer's
  `follows`, ordered newest-first, keyset-paged on `created_at`. Watch data is
  already world-readable under the open-read RLS model, so `INVOKER` is enough —
  no elevated privilege. Episode watches are **aggregated per (user, show,
  calendar day)** so a binge collapses to one "watched N episodes" row
  (`created_at = max(watched_at)`, a stable keyset key). The client
  (`src/lib/feed.ts`) hydrates authors / titles / reviews in batched `.in()`
  lookups, the same pattern as `getNotifications`; review events carry a full
  `ReviewItem` so the row reuses `ReviewRow`.

- **Notifications folded into the Feed, pinned on top.** The bell and the
  `/notifications` screen are removed; the unread badge moves to the **Feed tab**.
  Personal notifications keep their exact per-row `read_at` and are shown pinned
  above friends' activity; opening the Feed marks them read.

- **Inbox visibility via a single per-user watermark.** Friends' activity shows
  **unseen-first**; a seen row **lingers ~24h** then ages out. Because events are
  synthetic, seen-ness is one column, `profiles.feed_seen_at`, and `get_feed`
  filters `created_at > least(feed_seen_at, now() - interval '24 hours')` (unseen
  *or* fresh). The watermark advances to `now()` when the viewer **leaves** the
  Feed (`markFeedSeen`, on blur) so the list is stable while being read. Personal
  notifications use their own per-row rule — dropped **48h after** being seen —
  since they *do* have exact per-row state.

## Consequences

- **No materialised feed, no triggers, no duplication** — the source tables stay
  the single source of truth, and the migration is small. The price is a heavier
  read query; at current scale (friends, not millions) it's cheap. If reads ever
  get slow, we can add a written `feed_events` table behind the same RPC without
  touching the UI.
- **No Realtime for friends' activity** (pull-to-refresh + focus refetch). Live
  push pairs naturally with the deferred materialised-table design, not with the
  read-time `UNION`. Personal notifications keep their existing Realtime.
- **The watermark is approximate.** "Lingers ~24h" is measured from when an event
  was *posted*, not from the exact moment it was seen — an intentional
  simplification, since a single timestamp can't record per-event seen times.
- **ADR 0005 is superseded** — the notification → thread flow it optimised no
  longer exists; notifications tap through to the root `/review/[ratingId]`.
- **Privacy:** the feed never shows the viewer's own actions or events whose
  object is the viewer (a follow *of* you, a like/reply on *your* review — those
  are notifications). No per-user privacy toggle yet.
- Native tab behaviour differs across iOS/Android, so the tab (icon, badge) and
  the inbox aging must be device-tested on both.
