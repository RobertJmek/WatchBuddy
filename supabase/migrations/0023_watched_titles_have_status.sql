-- 0023: a title you've watched always has a Library status.
--
-- The WatchBuddy-export importer (ADR 0009) writes watches but no library rows,
-- so an imported history fed the Diary and Stats while the Library shelves
-- stayed empty. A single episode logged with + on an untracked show had the
-- same gap. The rule now lives in the database, so every installed build gets
-- it without an update:
--
--   * a watch inserted for a title with no library row creates one;
--   * a movie becomes Completed;
--   * a series becomes Completed when every aired episode (season >= 1) is
--     watched, otherwise Watching. When the catalog cache can't prove it's
--     finished (an aired season whose episodes aren't cached), it's Watching.
--
-- An existing row is never touched (`on conflict do nothing`): a status the user
-- chose wins. Existing watched titles without a row get one now (backfill).
--
-- Backward compatible: no column, function or policy changes. Every client path
-- that writes library_items after a watch already upserts (setLibraryStatus,
-- the TV Time importer's ignoreDuplicates upsert, the Python script), and
-- setFavorite only inserts after its update found no row, so a row created here
-- never makes an installed build hit a unique-violation.

-- Status a watched title should get. Server-only.
create or replace function public.watched_title_status(p_user uuid, p_title uuid)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when t.media_type = 'movie' then 'completed'
    when aired.n > 0
     and watched.n = aired.n
     and not exists (
       -- an aired season with nothing cached: can't prove it's finished
       select 1 from seasons s
       where s.title_id = p_title
         and s.season_number >= 1
         and s.air_date <= current_date
         and not exists (select 1 from episodes e where e.season_id = s.id)
     )
    then 'completed'
    else 'watching'
  end
  from titles t,
  lateral (
    select count(*) as n from episodes e
    where e.title_id = p_title and e.season_number >= 1 and e.air_date <= current_date
  ) aired,
  lateral (
    select count(distinct w.episode_id) as n
    from episode_watches w
    join episodes e on e.id = w.episode_id
    where w.user_id = p_user and w.title_id = p_title
      and e.season_number >= 1 and e.air_date <= current_date
  ) watched
  where t.id = p_title;
$$;

revoke execute on function public.watched_title_status(uuid, uuid) from public, anon, authenticated;

-- Statement-level, so a 500-row import chunk evaluates each title once.
-- security definer because the helper above is server-only; the rows it reads
-- come from `new_rows`, which already passed the watch tables' RLS
-- (user_id = auth.uid()), so it only ever writes the inserting user's rows.
create or replace function public.library_status_from_watches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into library_items (user_id, title_id, status, created_at, updated_at)
  select d.user_id, d.title_id, public.watched_title_status(d.user_id, d.title_id),
         d.last_watched, d.last_watched
  from (
    select user_id, title_id, max(watched_at) as last_watched
    from new_rows
    group by user_id, title_id
  ) d
  on conflict (user_id, title_id) do nothing;
  return null;
end;
$$;

revoke execute on function public.library_status_from_watches() from public, anon, authenticated;

create trigger trg_episode_watches_library_status
  after insert on public.episode_watches
  referencing new table as new_rows
  for each statement execute function public.library_status_from_watches();

create trigger trg_movie_watches_library_status
  after insert on public.movie_watches
  referencing new table as new_rows
  for each statement execute function public.library_status_from_watches();

-- The helper's per-title count reads a user's watches of one title.
create index if not exists episode_watches_user_title_idx
  on public.episode_watches (user_id, title_id);

-- Backfill: every watched title that has no library row yet. Dated by its
-- latest watch so an old imported history doesn't jump to the top of the
-- Library (sorted by created_at) or profile shelves (by updated_at).
insert into public.library_items (user_id, title_id, status, created_at, updated_at)
select d.user_id, d.title_id, public.watched_title_status(d.user_id, d.title_id),
       d.last_watched, d.last_watched
from (
  select user_id, title_id, max(watched_at) as last_watched
  from (
    select user_id, title_id, watched_at from public.episode_watches
    union all
    select user_id, title_id, watched_at from public.movie_watches
  ) w
  group by user_id, title_id
) d
where not exists (
  select 1 from public.library_items li
  where li.user_id = d.user_id and li.title_id = d.title_id
)
on conflict (user_id, title_id) do nothing;
