-- Fixes from the 2026-10-05 code review. Three server-side holes, all of them
-- reachable with nothing but the public anon key and a signed-in account:
--
--   1. The reply UPDATE policy let an author rewrite ANY column of their reply,
--      including rating_id -- so a reply could be posted somewhere allowed and
--      then moved under the review of someone who blocked its author, past the
--      insert-time check in 0020. Same class as 0017's notifications fix: RLS
--      decides rows, a column GRANT decides columns.
--   2. No text limits on the server. The username rule lived only in the app,
--      and review / reply / display name / bio were unbounded, so one API call
--      could put a megabyte of text into every follower's feed.
--   3. get_feed had no upper time bound when p_before is null, and the client
--      supplies watched_at / updated_at / created_at on insert. A future-dated
--      row therefore sat at the top of every follower's feed indefinitely.
--
-- Backward compatible: older clients only write the two reply columns they
-- already wrote, stay inside the limits the app already enforced (or now
-- enforces), and see fewer future-dated feed rows.

-- ---------------------------------------------------------------------------
-- 1. review_replies: the owner may change body and deleted_at, nothing else
-- ---------------------------------------------------------------------------
-- deleteReply (src/lib/replies.ts) writes exactly these two columns.
revoke update on public.review_replies from authenticated;
grant update (body, deleted_at) on public.review_replies to authenticated;

comment on policy "tombstone own" on public.review_replies is
  'Row scope for the owner''s own updates. Column scope is the UPDATE(body, '
  'deleted_at) grant from migration 0021 -- rating_id, parent_reply_id and '
  'created_at cannot be rewritten, so a reply cannot be moved past a block.';

-- ---------------------------------------------------------------------------
-- 2. Text limits, enforced only when the value CHANGES
-- ---------------------------------------------------------------------------
-- Triggers rather than CHECK constraints, on purpose. Postgres re-checks every
-- constraint on any UPDATE of a row, even NOT VALID ones, and both tables are
-- rewritten for unrelated reasons all the time: markFeedSeen updates every
-- profile on each Feed blur, and a score change re-sends the review text. A
-- legacy value over a limit would turn those into failures. Comparing NEW with
-- OLD keeps old rows working until their owner edits that very field.
--
-- Limits match the app's input maxLength values. 23514 = check_violation.

create or replace function public.enforce_profile_limits()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.username is distinct from old.username
     and new.username is not null
     and new.username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'username must be 3-20 characters: a-z, 0-9 or _'
      using errcode = '23514';
  end if;
  if new.display_name is distinct from old.display_name
     and char_length(new.display_name) > 40 then
    raise exception 'display_name is longer than 40 characters' using errcode = '23514';
  end if;
  if new.bio is distinct from old.bio
     and char_length(new.bio) > 160 then
    raise exception 'bio is longer than 160 characters' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- UPDATE only: a profile row is created by handle_new_user (from OAuth metadata,
-- which the user did not type) and can never be inserted twice by a client.
create trigger trg_profiles_limits
  before update on public.profiles
  for each row execute function public.enforce_profile_limits();

-- setRating is an UPSERT, and Postgres fires BEFORE INSERT on the proposed row
-- before it finds the conflict -- so on INSERT, "unchanged" means the existing
-- row for this (user, entity) already holds exactly this text. Without that, a
-- score change on a legacy over-limit review would fail.
create or replace function public.enforce_review_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- A null review (score only, or a deleted review) is always fine.
  if new.review is null or char_length(new.review) <= 2000 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.review is not distinct from old.review then
    return new;
  end if;
  if tg_op = 'INSERT' and exists (
    select 1 from public.ratings r
    where r.user_id = new.user_id
      and r.entity_type = new.entity_type
      and r.entity_id = new.entity_id
      and r.review = new.review
  ) then
    return new;
  end if;
  raise exception 'review is longer than 2000 characters' using errcode = '23514';
end;
$$;

create trigger trg_ratings_review_limit
  before insert or update on public.ratings
  for each row execute function public.enforce_review_limit();

create or replace function public.enforce_reply_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' or new.body is distinct from old.body)
     and char_length(new.body) > 1000 then
    raise exception 'reply is longer than 1000 characters' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_review_replies_body_limit
  before insert or update on public.review_replies
  for each row execute function public.enforce_reply_limit();

-- Trigger functions are not meant to be called directly. Revoke BY ROLE (0019).
revoke all on function public.enforce_profile_limits() from public, anon, authenticated;
revoke all on function public.enforce_review_limit()   from public, anon, authenticated;
revoke all on function public.enforce_reply_limit()    from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_feed: nothing from the future
-- ---------------------------------------------------------------------------
-- 0017's body verbatim, plus one condition in the outer WHERE. The outer filter
-- is the definition of the window; the per-branch pushdowns remain supersets of
-- it, so nothing else needs to change.
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
    -- A client-supplied timestamp in the future must not pin a row on top.
    and e.created_at <= now()
  order by e.created_at desc
  limit greatest(1, least(p_limit, 100));
$$;

grant execute on function public.get_feed(int, timestamptz) to authenticated;
