-- Backend hardening: the indexes the feed reads through, a narrower write grant
-- on notifications, a counter that cannot go negative, a signup that survives a
-- retry, catalog deletes that take their ratings with them, and a stamp that
-- stops OMDb being asked the same unanswerable question forever.
--
-- Every part is additive or narrowing-with-a-repair. Nothing here renames or
-- removes something a shipped binary reads -- see 0015 for why that matters.

-- ---------------------------------------------------------------------------
-- 1. Indexes for get_feed's per-actor lookups
-- ---------------------------------------------------------------------------
-- get_feed unions six branches, each filtering `<table>.user_id in (followees)`
-- and then bounded by time. Two of those tables had no index on user_id at all:
--   * review_likes is indexed on (rating_id, user_id) [PK] and (rating_id)
--   * review_replies on (rating_id, created_at)
-- Neither has user_id as a usable prefix, so both branches sequentially scanned
-- the whole table on every Feed open, for every viewer.
--
-- `ratings` and `follows` do have a user_id index, but not one carrying the
-- timestamp the branch filters on, so the time bound was a heap filter.
create index review_likes_user_created_idx   on public.review_likes   (user_id, created_at);
create index review_replies_user_created_idx on public.review_replies (user_id, created_at);
create index ratings_user_updated_idx        on public.ratings        (user_id, updated_at);
create index follows_follower_created_idx    on public.follows        (follower_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. get_feed: push the time window into each branch
-- ---------------------------------------------------------------------------
-- Body is 0011's, with the visibility window moved from the outer WHERE into
-- each branch so it can be answered by an index instead of after the fact. The
-- outer filter stays -- it remains the definition of the window; the pushdowns
-- are a superset of it.
--
-- Why the pushdowns are equivalent, branch by branch:
--
--   * The five non-aggregated branches emit one row per source row, with
--     created_at copied straight off the row. Filtering that same column in the
--     branch is exactly the outer filter, evaluated earlier.
--
--   * episode_watch aggregates per (user, title, calendar day) and emits
--     max(watched_at). Filtering `watched_at > lo` there would be WRONG: a group
--     straddling the bound would keep its max but lose rows from count(*).
--     So that branch is bounded by whole DAYS instead. Every row of a group
--     shares one calendar day, so a day bound either keeps a group entire or
--     drops it entire -- count(*) and max() are untouched. A group whose max
--     exceeds `lo` sits in a day at or after lo's day, so no surviving group is
--     dropped. The same argument mirrored gives the p_before upper bound.
--
-- Bounds are computed once (they are uncorrelated scalar subqueries, so the
-- planner evaluates them as InitPlans and can use them as index conditions).
-- 'infinity' stands in for a null p_before so the comparison stays sargable
-- rather than becoming `x is null or ...`.
create or replace function public.get_feed(
  p_limit int default 30,
  p_before timestamptz default null
)
returns table (
  type           text,
  actor_id       uuid,
  entity_id      uuid,
  target_user_id uuid,
  rating_id      uuid,
  count          int,
  value          int,
  created_at     timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with followees as (
    select followee_id from public.follows where follower_id = auth.uid()
  ),
  seen as (
    -- The viewer's watermark; coalesce guards a missing row (should not happen).
    select coalesce(
      (select feed_seen_at from public.profiles where id = auth.uid()),
      'epoch'::timestamptz
    ) as feed_seen_at
  ),
  bounds as (
    select
      s.feed_seen_at,
      s.feed_seen_at - interval '24 hours'                      as lo,
      date_trunc('day', s.feed_seen_at - interval '24 hours')    as lo_day,
      coalesce(p_before, 'infinity'::timestamptz)                as hi,
      coalesce(date_trunc('day', p_before) + interval '1 day',
               'infinity'::timestamptz)                          as hi_day
    from seen s
  ),
  events as (
    -- Episode watches, aggregated per (user, show, calendar day).
    select
      'episode_watch'::text as type,
      ew.user_id            as actor_id,
      ew.title_id           as entity_id,
      null::uuid            as target_user_id,
      null::uuid            as rating_id,
      count(*)::int         as count,
      null::int            as value,
      max(ew.watched_at)    as created_at
    from public.episode_watches ew
    where ew.user_id in (select followee_id from followees)
      and ew.watched_at >= (select lo_day from bounds)
      and ew.watched_at <  (select hi_day from bounds)
    group by ew.user_id, ew.title_id, date_trunc('day', ew.watched_at)

    union all
    select 'movie_watch', mw.user_id, mw.title_id, null, null, 1, null, mw.watched_at
    from public.movie_watches mw
    where mw.user_id in (select followee_id from followees)
      and mw.watched_at > (select lo from bounds)
      and mw.watched_at < (select hi from bounds)

    union all
    select
      case
        when r.review is not null and length(btrim(r.review)) > 0 then 'review'
        else 'rating'
      end,
      r.user_id, r.entity_id, null, r.id, 1, r.value::int, r.updated_at
    from public.ratings r
    where r.user_id in (select followee_id from followees)
      and r.entity_type in ('movie', 'show')
      and r.updated_at > (select lo from bounds)
      and r.updated_at < (select hi from bounds)

    union all
    select 'follow', f.follower_id, null, f.followee_id, null, 1, null, f.created_at
    from public.follows f
    where f.follower_id in (select followee_id from followees)
      and f.followee_id <> auth.uid()
      and f.created_at > (select lo from bounds)
      and f.created_at < (select hi from bounds)

    union all
    select 'like', rl.user_id, ra.entity_id, null, rl.rating_id, 1, null, rl.created_at
    from public.review_likes rl
    join public.ratings ra on ra.id = rl.rating_id
    where rl.user_id in (select followee_id from followees)
      and ra.user_id <> auth.uid()
      and rl.created_at > (select lo from bounds)
      and rl.created_at < (select hi from bounds)

    union all
    select 'reply', rp.user_id, ra.entity_id, null, rp.rating_id, 1, null, rp.created_at
    from public.review_replies rp
    join public.ratings ra on ra.id = rp.rating_id
    where rp.user_id in (select followee_id from followees)
      and rp.deleted_at is null
      and ra.user_id <> auth.uid()
      and rp.created_at > (select lo from bounds)
      and rp.created_at < (select hi from bounds)
  )
  select e.type, e.actor_id, e.entity_id, e.target_user_id, e.rating_id,
         e.count, e.value, e.created_at
  from events e, bounds b
  where e.actor_id <> auth.uid()
    -- Inbox rule: show if unseen (newer than the watermark) OR seen but still within
    -- 24h of the watermark. The window is anchored to the viewer's last Feed exit,
    -- not to now().
    and e.created_at > b.lo
    and (p_before is null or e.created_at < p_before)
  order by e.created_at desc
  limit greatest(1, least(p_limit, 100));
$$;

grant execute on function public.get_feed(int, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. notifications: a write grant as narrow as the intent
-- ---------------------------------------------------------------------------
-- 0008's "mark read" policy is an unrestricted `for update` on the owner's own
-- rows, and 0016 noted the name had grown narrower than what it permits. RLS
-- cannot restrict *columns*, so the owner could rewrite type, actor_id or
-- actor_count on their own rows -- inventing notifications that never happened.
--
-- Column-level privileges are the tool for that. The policy still decides WHICH
-- rows (yours), the grant decides WHICH columns (the two the client writes:
-- markRead/markAllRead touch read_at, dismiss/undismiss touch dismissed_at).
revoke update on public.notifications from authenticated;
grant update (read_at, dismissed_at) on public.notifications to authenticated;

comment on policy "mark read" on public.notifications is
  'Row scope for the owner''s own updates. Column scope is enforced separately by '
  'the UPDATE(read_at, dismissed_at) grant from migration 0017 -- the policy name '
  'predates dismissal and is kept only because renaming it is churn.';

-- The aggregating triggers decrement on unlike/unfollow and delete the row at
-- zero, so a negative count means something went wrong. Repair first (there
-- should be nothing to repair), then make it unrepresentable.
delete from public.notifications where actor_count < 0;

alter table public.notifications
  add constraint notifications_actor_count_check check (actor_count >= 0);

-- ...and stop the decrement from being the thing that breaks it. `greatest`
-- floors at zero, which is also the value the DELETE right below tests for, so
-- the drop-at-zero behaviour is unchanged. Both functions are otherwise
-- verbatim copies of 0016's.
create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  review_author uuid;
begin
  if tg_op = 'INSERT' then
    select user_id into review_author from ratings where id = new.rating_id;
    if review_author is null or review_author = new.user_id then
      return new; -- self-likes are blocked anyway; belt and braces
    end if;
    insert into notifications (user_id, type, actor_id, rating_id)
    values (review_author, 'like', new.user_id, new.rating_id)
    on conflict (user_id, rating_id) where (type = 'like')
    do update set
      actor_count  = notifications.actor_count + 1,
      actor_id     = excluded.actor_id,
      created_at   = now(),
      read_at      = null,
      dismissed_at = null;  -- a new like brings a dismissed row back
    return new;
  else -- DELETE: decrement; drop the row at zero
    select user_id into review_author from ratings where id = old.rating_id;
    update notifications
      set actor_count = greatest(actor_count - 1, 0)
      where user_id = review_author and rating_id = old.rating_id
        and type = 'like';
    delete from notifications
      where user_id = review_author and rating_id = old.rating_id
        and type = 'like' and actor_count <= 0;
    return old;
  end if;
end;
$$;

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.follower_id = new.followee_id then
      return new; -- the follows CHECK forbids it anyway; belt and braces
    end if;
    insert into notifications (user_id, type, actor_id, rating_id)
    values (new.followee_id, 'follow', new.follower_id, null)
    on conflict (user_id) where (type = 'follow')
    do update set
      actor_count  = notifications.actor_count + 1,
      actor_id     = excluded.actor_id,
      created_at   = now(),
      read_at      = null,  -- a new follower re-surfaces the row as unread
      dismissed_at = null;  -- ...even if it had been swiped away
    return new;
  else -- DELETE: decrement; drop the row at zero
    update notifications
      set actor_count = greatest(actor_count - 1, 0)
      where user_id = old.followee_id and type = 'follow';
    delete from notifications
      where user_id = old.followee_id and type = 'follow' and actor_count <= 0;
    return old;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Signup survives a duplicate profile row
-- ---------------------------------------------------------------------------
-- handle_new_user runs inside the auth.users INSERT, so a unique violation on
-- profiles.id does not just skip the profile -- it aborts the whole signup, and
-- the user gets an opaque "Database error saving new user".
--
-- profiles.id has an FK to auth.users, so a row cannot pre-exist for a new user;
-- the reachable way to hit the conflict is the trigger firing twice for one row,
-- which is what re-applying 0001 against a live database leaves behind. Cheap
-- insurance either way: the row already existing is the state we wanted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Catalog deletes take their ratings with them
-- ---------------------------------------------------------------------------
-- ratings.entity_id is polymorphic (0001 kept it FK-free on purpose so episode
-- ratings could arrive without a migration), which means nothing cleans up when
-- the row it points at goes away: the rating survives its title, counts towards
-- statistics, and renders as a review of nothing.
--
-- A trigger gives the cleanup the FK never could. It also reaches review_likes,
-- review_replies and notifications, which all cascade off ratings.id.
create or replace function public.delete_ratings_for_entity()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.ratings
   where entity_id = old.id
     and entity_type = any (tg_argv[0]::text[]);
  return old;
end;
$$;

comment on function public.delete_ratings_for_entity() is
  'AFTER DELETE cleanup for the polymorphic ratings.entity_id. The trigger argument '
  'is the array of entity_type values the deleted table stands for.';

create trigger trg_titles_ratings_cleanup
  after delete on public.titles
  for each row execute function public.delete_ratings_for_entity('{movie,show}');

create trigger trg_seasons_ratings_cleanup
  after delete on public.seasons
  for each row execute function public.delete_ratings_for_entity('{season}');

create trigger trg_episodes_ratings_cleanup
  after delete on public.episodes
  for each row execute function public.delete_ratings_for_entity('{episode}');

-- ---------------------------------------------------------------------------
-- 6. Stop re-asking OMDb a question it has already refused
-- ---------------------------------------------------------------------------
-- The tmdb-proxy cache gate forces a full refetch of any title that *could*
-- carry an IMDb rating but does not (`imdb_id` known, `imdb_rating` null), so
-- that enabling the OMDb key backfills on the next view. For a title OMDb simply
-- has no rating for, that condition is permanent: the title never caches, and
-- every single view spends one of the 1,000 requests the free tier allows per
-- day, forever.
--
-- Record when OMDb was last asked, so "not answered yet" and "asked recently and
-- got nothing" stop looking alike. The proxy re-asks on its own shorter TTL.
alter table public.titles add column imdb_checked_at timestamptz;

comment on column public.titles.imdb_checked_at is
  'When OMDb was last queried for this title, set whether or not it answered. '
  'Gates the imdb_rating backfill retry in tmdb-proxy so a title OMDb has no '
  'rating for stops costing one request per view. Null = never asked.';

-- Titles that already carry a rating were, by definition, answered when they
-- were cached; stamping them keeps the column meaningful from day one.
update public.titles set imdb_checked_at = cached_at where imdb_rating is not null;
