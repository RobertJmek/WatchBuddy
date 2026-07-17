# ADR 0001 — Review likes attach to rating rows

**Status:** accepted · 2026-07-17

## Context

WatchBuddy has no standalone review entity: a "review" is the optional text on
a `ratings` row (one row per user per movie/show). Likes on community reviews
need a target.

## Decision

`review_likes(rating_id → ratings.id, user_id, created_at)` with a composite
primary key — likes reference the **rating row**, not a new reviews table.
RLS: world-readable, insert/delete own rows only, and inserting a like on your
own rating is rejected (`not exists` check against `ratings`).

## Consequences

- No schema split or backfill; the unique `(user_id, entity_type, entity_id)`
  rating row remains the single source for score + text.
- If an author empties their review text, the UI stops showing hearts for it
  but the like rows persist harmlessly (and revive if text returns).
- Deleting a rating (or the account cascade) removes its likes via FK cascade.
- A future "liked by" list needs no schema change.
