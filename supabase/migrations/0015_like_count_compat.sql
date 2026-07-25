-- Compatibility shim for clients built before v1.13.0.
--
-- 0014 renamed `like_count` to `actor_count` (it counts followers now too). That
-- rename is breaking for every already-installed build: v1.12.3 and earlier
-- select `like_count` by name in getNotifications, so the whole notifications
-- query fails the moment the column disappears -- not just for users with a
-- follow notification, but for everyone, immediately.
--
-- Bring the old name back as a generated mirror of the new one. Old clients read
-- it, new clients read `actor_count`, and the triggers only ever write
-- `actor_count`, so the two cannot drift.
--
-- This does NOT make follow notifications themselves safe on an old client: a
-- follow row has `rating_id = null`, which the pre-1.13.0 getNotifications feeds
-- straight into `.in('id', ...)` as a uuid, and PostgREST rejects it. That
-- breakage is narrower (only a recipient of an actual new follow) and cannot be
-- fixed from the database -- an old binary has no rendering for a type it does
-- not know about.
--
-- DROP THIS COLUMN once no client older than v1.13.0 is in use. It is dead
-- weight the day the last 1.12.x install is gone.
alter table public.notifications
  add column like_count integer
  generated always as (actor_count) stored;

comment on column public.notifications.like_count is
  'Deprecated compatibility mirror of actor_count for clients < v1.13.0. Drop when those are gone. See migration 0015.';
