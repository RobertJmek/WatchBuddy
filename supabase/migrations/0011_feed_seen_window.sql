-- Anchor the friends'-activity visibility window to the seen watermark instead of
-- wall-clock now(). Robert's intent: a feed item's 24h lifespan should be measured
-- from when it was *seen*, not from when it was created.
--
-- 0010 used `created_at > least(feed_seen_at, now() - interval '24 hours')`, whose
-- `now() - 24h` term expires items 24h after they were *created* (frequent-visitor
-- case). Replacing that anchor with `feed_seen_at - interval '24 hours'` ties the
-- window to the viewer's visits:
--   * Unseen (created_at > feed_seen_at) always shows — never expires before seen.
--   * Seen items linger until the watermark (last Feed exit) moves 24h past their
--     created_at, i.e. they drop off at the first visit >= 24h after they appeared.
--   * Self-clearing, no resurfacing of ancient rows (unlike a `now() < watermark+24h`
--     grace, which would revive all history for anyone who checks in often).
--
-- Single-watermark limitation (accepted): an item already old when first seen does
-- not get a fresh 24h from the viewing moment; true per-item timers would need a
-- per-event seen table. See ADR 0006 and plan.
--
-- Body is identical to 0010 except the final WHERE clause.
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
    -- Inbox rule: show if unseen (newer than the watermark) OR seen but still within
    -- 24h of the watermark. The window is anchored to the viewer's last Feed exit,
    -- not to now().
    and e.created_at > s.feed_seen_at - interval '24 hours'
    and (p_before is null or e.created_at < p_before)
  order by e.created_at desc
  limit greatest(1, least(p_limit, 100));
$$;

grant execute on function public.get_feed(int, timestamptz) to authenticated;
