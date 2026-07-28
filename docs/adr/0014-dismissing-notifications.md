# 0014 — Dismissing a notification

**Status:** accepted · shipped in v1.15.0

## Context

Notifications are pinned atop the Feed (ADR 0006). Nothing in the app could get
rid of one. They leave on a clock: `getNotifications` drops **read** rows 48h
after they were read, and unread rows never leave at all. A notification you had
already dealt with kept sitting at the top of the screen until the clock agreed.

The obvious affordance is the one every mail client has — swipe it away.

**Feed rows are deliberately out of scope**, even though on screen they look like
the same kind of thing sitting right below. A feed row is not a row: it comes out
of the `get_feed` UNION, and `feed.ts` has to *synthesise* its key from
`type:actor:entity:created_at` — "no natural row id from a UNION". That key
embeds a timestamp, and binge episode watches aggregate into one row as more
watches land, so the same conceptual event can change key underneath you.
Persisting it as a dismissal token would be storing a pointer that moves. Feed
ageing stays what it is: a per-account watermark (`profiles.feed_seen_at`), not
per-item state. Dismissable feed rows would need their own identity scheme and
their own decision; this ADR does not make it.

## Decision

**Dismissal hides a row; it does not delete it.** New column
`notifications.dismissed_at` (migration `0016`), filtered out of
`getNotifications` and `getUnreadCount`.

Deleting was the simpler read, and was rejected on two counts. It needs a new
`delete` RLS policy, whereas `0008`'s existing `"mark read"` policy is an
unrestricted owner `for update` and already permits writing `dismissed_at` —
**no policy change at all**. And the rows are aggregates: a like notification is
one row per (recipient, review) that the trigger counts into. Keeping the row is
what makes the next decision possible.

**New activity brings a dismissed row back**, as unread. The like and follow
triggers fold new actors into the *existing* row via `on conflict … do update`,
so migration `0016` adds `dismissed_at = null` to both `do update` lists. Without
that one assignment, dismissing "2 people liked your review" would silently
swallow the 3rd like and every one after it — the row is never re-inserted, only
updated. Dismissing therefore means *"I'm done with what this says now"*, not
*"never mention this review again"*. Reply notifications are plain inserts and
need nothing.

**Dismissing also marks read.** A row you can no longer see must not keep the
unread badge alive, so `dismissNotification` writes `read_at` alongside
`dismissed_at`.

**Undo is an inline strip, for ~4s, in the row's own position.** A gesture that
makes something vanish needs a way back, and the project has no snackbar
component — a global one would be more machinery than this earns. `DismissedNotice`
stands in the dismissed row's index inside the pinned block: it's where you were
looking when it happened. Only one strip exists at a time; a second swipe
replaces it, because the first dismissal is already committed. The strip is an
offer, not a pending state.

**Swipe right only**, red `Dismiss` reveal. Left was built first, on the grounds
that it matched the direction convention already in the app (`swipe-to-log-row`:
right = the positive action, left = undo/destructive). Robert chose right anyway,
which is the call that stands. The cost is worth naming: the same drag now means
opposite things on two screens — swiping a search result right *logs* a watch,
swiping a notification right *removes* it. If that ever reads as wrong, the
notification is the one to flip; the log row is the older, more-used gesture.

## Consequences

- **The migration is additive, and that is the point.** `0014` renamed a column
  and broke every installed binary the instant it ran; `0015` is the apology
  still sitting in the schema. A new nullable column breaks nobody. Clients
  ≤ v1.14.x don't filter on it and will keep showing rows dismissed elsewhere —
  a cosmetic regression on old builds, nothing more.
- **The migration must be applied before the build ships.** The new client filters
  on a column that doesn't exist yet; until `supabase db push` runs, the whole
  notifications query would fail — for everyone, not just dismissers.
- **`SwipeToDismissRow` is a sibling of `SwipeToLogRow`, not a mode of it.** That
  component's vocabulary (`onLog`, `logLabel`, `longLog`) is about watches;
  generalising it would cost both files their readability to save ~30 lines. Both
  obey the same two hard rules: `Swipeable` from the **main** `react-native-gesture-handler`
  entry (the subpath double-registers `RNGestureHandlerButton` and crashes the app
  at launch — that shipped as v1.12.0), and **no haptics inside the component**,
  so a future tap-button can't double-buzz.
- **Haptics: `hapticUndo()` on the swipe**, fired at the optimistic moment;
  `hapticSuccess()` when Undo restores the row; `hapticFailure()` if the write
  fails and the list rolls back. All via `lib/haptics.ts`, never `expo-haptics`.
- **`['feed']` is not invalidated** — a notification is not a feed row.
  `['notifications']` and `['notifUnread']` are, the latter because dismissal
  writes `read_at`. Same discipline as `rating-bar` invalidating `['library']`
  while `review-thread` doesn't.
- **Nothing here is checkable without a device.** There's no pure module to
  exercise (a column filter and two writes), and the risk is entirely in the
  gesture — which is exactly the class of bug that shipped v1.12.0 broken.
