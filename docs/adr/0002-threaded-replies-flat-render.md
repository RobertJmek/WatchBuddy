# ADR 0002 — Threaded replies, two-level render, tombstone deletion

**Status:** accepted · 2026-07-17

## Context

Reviews (text on `ratings` rows, ADR 0001) gain replies. Nested threading was
wanted, but deep trees render poorly on phone screens, and deleting a parent
must not orphan other people's replies.

## Decision

- `review_replies` stores the **full tree** (`parent_reply_id`, arbitrary
  depth), but the UI renders **two visual levels**: every descendant flattens
  under its top-level ancestor, chronologically, prefixed with an `@username`
  mention of its direct parent.
- **Deletion = tombstone**: RLS has insert/select/update policies but **no
  delete policy**; "deleting" sets `deleted_at` and blanks `body`, and the row
  renders as "[deleted comment]". Children keep their thread context.
- Hard deletes happen only via cascades: rating removed → replies go with it;
  account deleted → the user's reply rows go, and `parent_reply_id … on delete
  set null` promotes other users' children to top level.

## Consequences

- Switching to Reddit-style visual nesting later is a render-only change.
- Reply counts must exclude tombstones (`deleted_at is null`).
- No editing in v1 — delete (tombstone) and repost.
