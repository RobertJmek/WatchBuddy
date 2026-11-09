-- 0024: bring the migrations in line with the indexes production really has.
--
-- A `supabase inspect report` (2026-11-10, 135 days of statistics) showed eleven
-- indexes in production that no migration creates; they were added by hand.
-- Five are used, so a database built from the migrations alone was missing
-- them. Six have never been scanned and are covered by another index.
--
-- Backward compatible: indexes only. No column, constraint, function, policy or
-- grant changes, and none of the dropped indexes backs a constraint.

-- Used in production: create them where they're missing (a no-op in prod).
create index if not exists episode_watches_title_id_idx
  on public.episode_watches (title_id);
create index if not exists episode_watches_watched_at_idx
  on public.episode_watches (watched_at);
create index if not exists movie_watches_title_id_idx
  on public.movie_watches (title_id);
create index if not exists movie_watches_watched_at_idx
  on public.movie_watches (watched_at);

-- library_items (created_at) exists twice in production: `_idx` was never
-- scanned, `_idx1` is the one the planner uses. Keep that one under the plain name.
drop index if exists public.library_items_created_at_idx;
alter index if exists public.library_items_created_at_idx1
  rename to library_items_created_at_idx;
create index if not exists library_items_created_at_idx
  on public.library_items (created_at);

-- Never scanned. Library reads filter by user_id first; episodes are always
-- filtered by title_id as well; ratings use ratings_entity_idx (0012).
drop index if exists public.library_items_updated_at_idx;
drop index if exists public.library_items_updated_at_idx1;
drop index if exists public.episodes_season_number_idx;
drop index if exists public.ratings_entity_id_idx;
drop index if exists public.ratings_entity_type_idx;
