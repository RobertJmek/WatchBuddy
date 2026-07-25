# ADR 0012 — "X followed you" notifications

**Status:** accepted · 2026-07-25

## Context

Following someone was the one social action that produced no notification: the
followee learned about it only by checking their follower count. Adding a
`'follow'` type to `notifications` (ADR 0003) is not additive, because the table
was shaped entirely around reviews — `rating_id` is `not null` with an FK to
`ratings`, and a follow has no rating behind it.

Two other things constrained the design:

- `follow()` in `src/lib/social.ts` swallows a `23505` unique violation, so a
  follow of someone you already follow is a client-side no-op that never reaches
  the database.
- `get_feed` (migration `0011`) **already** emits `'follow'` events for the
  activity feed, but deliberately excludes follows *of* the viewer, with the
  comment "those are the viewer's business, surfaced elsewhere."

## Decision

- **`rating_id` becomes nullable**, rather than adding a separate target column.
  A follow's target is the recipient, who is already `user_id`, and its actor is
  already `actor_id` — a new column would carry no information. The invariant the
  `not null` used to enforce is restored explicitly as
  `check ((type = 'follow') = (rating_id is null))`, so review notifications
  still cannot lose their rating.
- **`like_count` is renamed `actor_count`.** It now counts followers as well as
  likers; a second parallel count column would be worse. Only two files read it.
  The rename is breaking for installed clients, so migration `0015` re-adds
  `like_count` as a generated mirror of `actor_count` — a shim to drop once no
  build older than v1.13.0 is in use.
- **Follows aggregate per recipient** — a partial unique index on `(user_id)
  where type = 'follow'`. Ten new followers are one row that advances its
  `actor_count`/`actor_id`/`created_at` and clears `read_at`. This is the like
  behaviour with the rating dropped from the key, so the aggregate is
  account-wide.
- **Unfollowing retracts**: the DELETE branch decrements and the row disappears
  at zero, again mirroring unlike. A re-follow after an unfollow is a genuine
  INSERT, so it re-notifies; the `23505` swallow only hides the case where you
  already follow the person, where doing nothing is correct.
- **Tapping a follow notification opens `/user/[id]`**, not a review thread —
  the row branches on `ratingId` being null.
- **The activity feed is left alone.** Surfacing follows-of-the-viewer there as
  well would show the same event twice on the Feed screen, since notifications
  are pinned above the feed (ADR 0006). The notification *is* the "elsewhere"
  `get_feed`'s comment refers to.

## Consequences

- Every consumer of `notifications` must now treat `rating_id` as optional. In
  practice that is `src/lib/notifications.ts` (which skips the rating/title
  lookups when the id set is empty) and `src/components/notification-row.tsx`.
- Aggregation is account-wide, so a follow notification cannot say *which* older
  followers it folded in — only the most recent actor plus a count. Accepted:
  the follower list on the profile is the complete record.
- After a decrement, `actor_id` may still name someone who has since unfollowed
  (the row keeps the last actor to arrive, not the last remaining one). This wart
  is inherited from the like trigger and is accepted for the same reason: fixing
  it means re-deriving the newest surviving actor on every delete.
- The migration rewrites a constraint on a live table, so it must be applied
  before shipping a client that can render follow rows.
- **Old clients are only partly protected.** `0015` restores the `like_count`
  name, but a follow row itself is unrenderable before v1.13.0: `rating_id` is
  null and the old `getNotifications` passes it into `.in('id', ...)`, which
  PostgREST rejects as an invalid uuid, failing the whole notifications query.
  The exposure is narrow — it needs an actual new follow to arrive — and cannot
  be closed from the database. Upgrade before publicising the feature.

See also: ADR 0003 (triggers + Realtime), ADR 0006 (notifications pinned atop the
Feed), migration `supabase/migrations/0014_follow_notifications.sql`.
