# ADR 0021 — Activity and Notifications as two segments of the Feed tab

**Status:** accepted · targets v1.18.0 · **amends [ADR 0006](0006-activity-feed-notifications-inbox.md)**

## Context

ADR 0006 folded the old `/notifications` screen into the Feed tab and pinned
personal notifications — likes and replies on your reviews, and since ADR 0012
new followers — above friends' activity on one scroll surface. That removed a
screen and a bell from the Library header, which was the point, but it left two
problems that only showed up in use:

- **The two kinds of row are visually one kind.** A notification is something
  that *needs you*; a feed row is *news about someone else*. Pinned on top of
  the same list, in rows of the same size and shape, nothing says which is
  which. Scrolling down a few rows loses the boundary entirely.
- **The tab badge stopped meaning anything.** `markAllRead()` ran inside the
  Feed's `useFocusEffect`, so the badge cleared the instant the tab took focus —
  whether or not the notifications were ever looked at. Tapping Feed to check
  what friends watched silently marked three likes and a new follower as read.
  A badge that clears on arrival is a badge that only ever says "something
  happened at some point", which is not worth a number.

Neither is a data problem. `get_feed`, the `notifications` table, the watermark
and the 48h read-aging rule all still do exactly what ADR 0006 decided. This is
about where the two lists are and when "read" is claimed.

## Decision

### One tab, two segments

A segmented control — **Activity | Notifications** — at the top of the Feed tab,
under the heading. Considered and rejected:

- **Reviving a `/notifications` route.** It is what ADR 0006 deliberately
  removed; bringing back a second destination re-creates the "where do I look?"
  problem, and the badge would have to point somewhere other than a tab.
- **A collapsible notifications card** above the feed. Keeps both on one
  surface, so it fixes neither complaint properly: the card is still in the
  scroll, and "opened the card" is not a clean signal for marking read.

The segment control is a **view switch, not navigation** — no route, no
`Stack.Protected` entry, no back behaviour to reason about. The segment is plain
`useState`, not persisted: every cold start opens on Activity, which is the tab's
own subject. There is deliberately **no auto-jump** to Notifications when unread
is non-zero — a tab that moves under you is worse than a badge you have to tap.

### Both lists stay mounted

Each segment is its own `FlatList`; the hidden one is hidden with
`display: none`, not unmounted. So Activity keeps its scroll offset and the feed
pages it already fetched across a trip to Notifications and back, and
Notifications keeps its pending Undo strips.

This is also why the segments are **not** a horizontal pager. A pager is the
obvious shape for two peer views, and it would put a horizontal swipe in direct
conflict with `SwipeToDismissRow`, which is the gesture on every notification
row (ADR 0014). `display: none` costs one always-mounted list and no dependency.

`onEndReached` lives only on the Activity list, so the short Notifications list
can never ask `get_feed` for a page nobody will read.

### The badge counts notifications, and clears when you look at them

The tab badge is unchanged in meaning (`getUnreadCount`) and unchanged in code —
what changes is when it is allowed to clear. `markAllRead()` moves out of
`useFocusEffect` into an effect keyed on `[isFocused, segment]`: it runs when the
tab is focused **and** the Notifications segment is showing. Being on Activity
does not mark anything read, however long you stay.

The Notifications segment carries the same count on its label, so the badge on
the tab points at something visible rather than at a screen you have to guess
at. That count is `notifications.filter(n => n.unread).length` over the list
already loaded — not a third query. It and the badge come from different sources
(the 100-row list vs. a `count` query) but are invalidated on the same events, so
they agree in practice.

Rows keep their unread highlight until the next refetch, exactly as before:
reading marks them read, it does not make them vanish under your eyes.

### Unchanged on purpose

- **Zero SQL.** No migration, no RPC change. The 24h watermark window
  (`profiles.feed_seen_at`, ADR 0006's update) and the 48h read-aging of
  notifications are untouched, and `markFeedSeen()` still fires on blur of the
  whole tab rather than on leaving the Activity segment — the watermark is about
  the tab, and stamping it on a segment switch would age out rows you came back
  to two seconds later.
- **Feed rows stay non-dismissible** — they come out of a `UNION` and have no
  stable id (ADR 0014).
- **Pull-to-refresh refreshes both sources** from either segment. Refreshing is
  about the tab, not the list under the finger.
- No activity filters, no realtime on the feed.

## Consequences

- `feed.tsx` goes from a 300-line screen that was also a list to an orchestrator
  that owns the two queries, the refresh control, the realtime subscription and
  the segment; `activity-list.tsx` and `notifications-list.tsx` own their
  rendering, and the dismiss/undo machinery moves wholesale into the latter,
  where it belongs.
- **One extra always-mounted `FlatList`.** Notifications is capped at 100 rows
  and windowed, so the cost is a few off-screen rows, not a second feed.
- The badge can now **persist across a Feed visit**, which is new behaviour and
  the whole point. A user who never opens the Notifications segment keeps a
  number on the tab until they do.
- A notification arriving while you sit on the Notifications segment re-badges
  the tab you are looking at, because `markAllRead` runs on entering the
  segment, not continuously. That is the pre-existing behaviour (it used to
  re-badge on the Feed tab), and fixing it properly means marking read per row.
- `SegmentedControl` is generic and has no second caller yet. It was still worth
  extracting: the a11y contract (`tablist` / `tab` + `accessibilityState`, and a
  spoken noun for the badge rather than a bare number — ADR 0018 rule 2) is the
  kind of thing that gets copied wrong.
