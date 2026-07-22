-- Following activity feed. A read-time fan-out: get_feed() UNIONs the activity
-- source tables, scoped to who the viewer follows, newest first, keyset-paged.
-- There is no materialised feed table and no triggers — the source tables stay
-- the single source of truth and reads are cheap at current scale. If reads ever
-- get slow, this can be swapped for a written table without touching the UI.
-- See CONTEXT.md "Feed".
--
-- SECURITY INVOKER: watch/rating/follow/like/reply rows are already world-open
-- under the open-read RLS policy (migration 0004), so no elevated privilege is
-- needed; the function just leans on auth.uid() to scope the followee set.

create or replace function public.get_feed(
  p_limit int default 30,
  p_before timestamptz default null
)
returns table (
  type           text,
  actor_id       uuid,
  entity_id      uuid,   -- title id, when the event is about a title (nullable)
  target_user_id uuid,   -- the other user, for follow events (nullable)
  rating_id      uuid,   -- for rating/review/like/reply events (nullable)
  count          int,    -- aggregated episode count; 1 for atomic events
  value          int,    -- rating score, for rating/review events (nullable)
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
  events as (
    -- Episode watches, aggregated per (user, show, calendar day):
    -- a binge collapses to one "N episodes" row. max(watched_at) is a stable
    -- keyset sort key — a past day's group never rewrites.
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
    group by ew.user_id, ew.title_id, date_trunc('day', ew.watched_at)

    union all
    -- Movie watches, atomic.
    select 'movie_watch', mw.user_id, mw.title_id, null, null, 1, null, mw.watched_at
    from public.movie_watches mw
    where mw.user_id in (select followee_id from followees)

    union all
    -- Ratings / reviews on titles (movie/show only, so entity_id is a title id).
    -- 'review' when there is written text, else 'rating'.
    select
      case
        when r.review is not null and length(btrim(r.review)) > 0 then 'review'
        else 'rating'
      end,
      r.user_id, r.entity_id, null, r.id, 1, r.value::int, r.updated_at
    from public.ratings r
    where r.user_id in (select followee_id from followees)
      and r.entity_type in ('movie', 'show')

    union all
    -- Follows. Exclude follows *of* the viewer (those are the viewer's business,
    -- surfaced elsewhere) — the feed is about friends' activity, not you.
    select 'follow', f.follower_id, null, f.followee_id, null, 1, null, f.created_at
    from public.follows f
    where f.follower_id in (select followee_id from followees)
      and f.followee_id <> auth.uid()

    union all
    -- Review likes. Exclude likes on the viewer's own reviews (that's a notification).
    select 'like', rl.user_id, ra.entity_id, null, rl.rating_id, 1, null, rl.created_at
    from public.review_likes rl
    join public.ratings ra on ra.id = rl.rating_id
    where rl.user_id in (select followee_id from followees)
      and ra.user_id <> auth.uid()

    union all
    -- Review replies (tombstones excluded). Exclude replies on the viewer's own
    -- reviews (notification territory).
    select 'reply', rp.user_id, ra.entity_id, null, rp.rating_id, 1, null, rp.created_at
    from public.review_replies rp
    join public.ratings ra on ra.id = rp.rating_id
    where rp.user_id in (select followee_id from followees)
      and rp.deleted_at is null
      and ra.user_id <> auth.uid()
  )
  select type, actor_id, entity_id, target_user_id, rating_id, count, value, created_at
  from events
  -- Never surface the viewer's own actions (defensive; a followee is never self).
  where actor_id <> auth.uid()
    and (p_before is null or created_at < p_before)
  order by created_at desc
  limit greatest(1, least(p_limit, 100));
$$;

grant execute on function public.get_feed(int, timestamptz) to authenticated;
