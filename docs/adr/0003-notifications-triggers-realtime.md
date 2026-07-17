# ADR 0003 — Notifications via Postgres triggers + Realtime

**Status:** accepted · 2026-07-17

## Context

Review activity (replies, likes) needs in-app notifications, delivered live.
The producer could be the client (write a notification row alongside the
action) or the database itself.

## Decision

- **Triggers produce notifications** (`security definer` functions on
  `review_replies` insert and `review_likes` insert/delete). Clients have no
  insert policy on `notifications` at all — rows are unforgeable and atomic
  with the event that caused them.
- **Likes aggregate**: a partial unique index on `(user_id, rating_id) where
  type = 'like'` turns the trigger into an upsert — one row per review whose
  `like_count`/`actor_id`/`created_at` advance and whose `read_at` clears on
  each new like; unlikes decrement and the row disappears at zero.
- **Replies itemize**: one row per reply, to the review author and (when
  distinct) the parent reply's author; the actor never notifies themselves.
- **Delivery is Supabase Realtime** (`postgres_changes` on the table, filtered
  `user_id=eq.<viewer>`; RLS applies). The client subscription just
  invalidates React Query caches — the queries stay the source of truth.

## Consequences

- No notification fan-out logic in app code; new event types are new triggers.
- Read state is coarse (screen open marks all read) — fine for v1.
- Push notifications later can reuse the same table (e.g. a webhook/edge
  function on insert) without schema changes.
