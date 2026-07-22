-- The feed becomes an activity inbox: friends' activity shows unseen-first and a
-- seen item lingers ~24h before dropping off. There is no per-event seen state
-- (feed events are synthetic, from a 6-table UNION), so seen-ness is tracked with
-- a single per-user watermark. Personal notifications keep their own exact
-- per-row read_at (see notifications table) and are handled client-side.
--
-- feed_seen_at advances to now() when the viewer leaves the Feed screen.
-- Defaulting existing rows to now() means "everything before this deploy counts
-- as already seen" — no history flood on the first open.

alter table public.profiles
  add column if not exists feed_seen_at timestamptz not null default now();

-- Recreate get_feed with the inbox visibility bound. Body is unchanged from
-- 0009 except the final WHERE, which now also drops events that are both already
-- seen (created before the watermark) and older than 24h.
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
    group by ew.user_id, ew.title_id, date_trunc('day', ew.watched_at)

    union all
    select 'movie_watch', mw.user_id, mw.title_id, null, null, 1, null, mw.watched_at
    from public.movie_watches mw
    where mw.user_id in (select followee_id from followees)

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

    union all
    select 'follow', f.follower_id, null, f.followee_id, null, 1, null, f.created_at
    from public.follows f
    where f.follower_id in (select followee_id from followees)
      and f.followee_id <> auth.uid()

    union all
    select 'like', rl.user_id, ra.entity_id, null, rl.rating_id, 1, null, rl.created_at
    from public.review_likes rl
    join public.ratings ra on ra.id = rl.rating_id
    where rl.user_id in (select followee_id from followees)
      and ra.user_id <> auth.uid()

    union all
    select 'reply', rp.user_id, ra.entity_id, null, rp.rating_id, 1, null, rp.created_at
    from public.review_replies rp
    join public.ratings ra on ra.id = rp.rating_id
    where rp.user_id in (select followee_id from followees)
      and rp.deleted_at is null
      and ra.user_id <> auth.uid()
  )
  select e.type, e.actor_id, e.entity_id, e.target_user_id, e.rating_id,
         e.count, e.value, e.created_at
  from events e, seen s
  where e.actor_id <> auth.uid()
    -- Inbox rule: show if unseen (newer than the watermark) OR fresh (< 24h old).
    and e.created_at > least(s.feed_seen_at, now() - interval '24 hours')
    and (p_before is null or e.created_at < p_before)
  order by e.created_at desc
  limit greatest(1, least(p_limit, 100));
$$;

grant execute on function public.get_feed(int, timestamptz) to authenticated;
