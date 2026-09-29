-- Block and report, for user-generated content.
--
-- Reviews, replies and profiles are user-generated, and until now the app had no
-- in-app way to report one or to stop seeing a person (Apple guideline 1.2 and
-- Google Play's UGC policy both ask for both). This migration adds:
--
--   * `blocks`  -- a MUTUAL block: neither side sees the other's reviews,
--                  replies, likes, watches, library or follows, and neither can
--                  follow, reply to or like the other.
--   * `reports` -- an insert-only inbox that Robert reads in the Supabase
--                  Dashboard. A reported review or reply disappears at once for
--                  the person who reported it.
--
-- The filtering lives in the READ POLICIES, not in the client. Watch data and
-- reviews are open-read (`using (true)`) and `get_feed` / `get_stats` are
-- `security invoker`, so a policy that hides a blocked user's rows covers the
-- feed, review lists, threads, likes, diary and stats in one place -- including
-- on binaries that are already installed, which have no idea blocks exist and
-- simply see fewer rows. Doing this in JS would miss every older client and every
-- query that forgot to apply the filter. See docs/adr/0025-block-and-report.md.
--
-- `profiles` stays fully readable ON PURPOSE. Installed clients hydrate names and
-- avatars by looking a user id up in `profiles`; a row that vanishes there can
-- crash them. The profile screen handles the block itself.
--
-- Backward compatible by construction: an old client only ever sees fewer rows.
-- The NEW client calls `block_user` and inserts into `reports`, so this must be
-- applied in prod before the build that ships them.

-- ---------------------------------------------------------------------------
-- 1. blocks
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- The PK covers "who did I block"; this is the reverse lookup ("who blocked me")
-- that hidden_user_ids() needs for the other half of a mutual block.
create index blocks_blocked_idx on public.blocks (blocked_id);

comment on table public.blocks is
  'One row per block, stored as blocker -> blocked but MUTUAL in effect: every read '
  'policy hides both directions (see hidden_user_ids). Written only by block_user; '
  'the blocker can read and delete their own rows.';

alter table public.blocks enable row level security;

-- Grants are explicit and by role: a table created in `public` is granted to
-- anon/authenticated by Supabase's default privileges (the lesson of 0019), and
-- a new table is not reachable through the Data API without a grant at all.
-- There is deliberately NO insert grant. A block must go through block_user(),
-- which also removes the follows between the pair; a bare insert would leave
-- those edges behind, to resurface if the block were ever lifted.
revoke all on public.blocks from anon, authenticated;
grant select, delete on public.blocks to authenticated;

-- Only the blocker can read a block ROW. That is not the same as a block being
-- secret: hidden_user_ids() below hands each side the ids that are hidden from
-- them, direction unstated, and the profile screen turns that into "This profile
-- isn't available". Someone who knows whom they blocked themselves can work out
-- who blocked them. The app never announces a block; it also does not pretend
-- the other person cannot notice one (ADR 0025).
create policy "blocks own read" on public.blocks
  for select to authenticated using (auth.uid() = blocker_id);
create policy "blocks own delete" on public.blocks
  for delete to authenticated using (auth.uid() = blocker_id);

-- ---------------------------------------------------------------------------
-- 2. reports
-- ---------------------------------------------------------------------------
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('review', 'reply', 'user')),
  -- ratings.id for a review, review_replies.id for a reply, profiles.id for a
  -- user. Polymorphic, so no FK -- the same call 0001 made for ratings.entity_id.
  target_id   uuid not null,
  reason      text not null check (reason in ('spam', 'harassment', 'spoilers', 'other')),
  note        text check (char_length(note) <= 500),
  created_at  timestamptz not null default now(),
  -- Reporting the same thing twice is one report. The client treats the unique
  -- violation as success, the way follow() treats a duplicate edge.
  unique (reporter_id, target_type, target_id)
);

comment on table public.reports is
  'Reports of user content, read by the operator in the Supabase Dashboard. '
  'Insert-only for clients: there is no select/update/delete grant for '
  'anon or authenticated. reported_ids() reads it (as definer) to hide a reported '
  'review or reply from its reporter.';

alter table public.reports enable row level security;

revoke all on public.reports from anon, authenticated;
grant insert on public.reports to authenticated;

create policy "reports own insert" on public.reports
  for insert to authenticated with check (auth.uid() = reporter_id);

-- ---------------------------------------------------------------------------
-- 3. The two sets the read policies filter by
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because `blocks` and `reports` are (correctly) unreadable to
-- the caller beyond their own rows, and because a mutual block needs the rows
-- where the caller is the BLOCKED side -- which no policy lets them see.
--
-- Used as `user_id not in (select public.hidden_user_ids())`: the subquery does
-- not reference the outer row, so the planner evaluates it once per query and
-- probes the result, instead of calling the function per row.
create or replace function public.hidden_user_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select blocked_id from public.blocks where blocker_id = auth.uid()
  union
  select blocker_id from public.blocks where blocked_id = auth.uid();
$$;

comment on function public.hidden_user_ids() is
  'Every user the caller has blocked or been blocked by (a block is mutual). Used by '
  'the read policies; also called by the client to tell "you blocked them" from '
  '"this profile is not available" and to filter user search. Returns ids only.';

-- Review and reply ids the caller has reported.
create or replace function public.reported_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select target_id from public.reports
  where reporter_id = auth.uid() and target_type in ('review', 'reply');
$$;

-- Revoke BY ROLE (0019): Supabase's default privileges give anon and
-- authenticated an explicit EXECUTE on every new function, and `from public`
-- does not undo an explicit grant. anon has no business with either.
revoke all on function public.hidden_user_ids() from public, anon, authenticated;
revoke all on function public.reported_ids()    from public, anon, authenticated;
grant execute on function public.hidden_user_ids() to authenticated;
grant execute on function public.reported_ids()    to authenticated;

-- Internal helper for the notification triggers below: is there a block between
-- these two people, in either direction? Callable ONLY by the trigger functions
-- (which run as their owner); granting it to authenticated would let anyone probe
-- whether two arbitrary users have blocked each other.
create or replace function public.blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

revoke all on function public.blocked_between(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Read policies: everything a blocked person wrote or did disappears
-- ---------------------------------------------------------------------------
-- 0004 created a permissive `using (true)` SELECT policy next to each table's
-- owner-only "own rows" policy; permissive policies OR together, so the owner
-- keeps seeing their own rows whatever is decided here. Replacing the open ones
-- narrows what OTHER people's rows a viewer can see, and nothing else.

-- Watch history, library: hidden while blocked. (They are read together on a
-- profile, in get_feed and in get_stats, all of which run as the caller.)
drop policy "watch data public read" on public.library_items;
drop policy "watch data public read" on public.episode_watches;
drop policy "watch data public read" on public.movie_watches;
drop policy "watch data public read" on public.ratings;

create policy "watch data read" on public.library_items
  for select to authenticated
  using (user_id not in (select public.hidden_user_ids()));
create policy "watch data read" on public.episode_watches
  for select to authenticated
  using (user_id not in (select public.hidden_user_ids()));
create policy "watch data read" on public.movie_watches
  for select to authenticated
  using (user_id not in (select public.hidden_user_ids()));

-- A rating is also hidden from someone who REPORTED it, which is how "the
-- reported item disappears immediately" is delivered (its score goes with its
-- text -- a rating is one row).
create policy "ratings read" on public.ratings
  for select to authenticated
  using (
    user_id not in (select public.hidden_user_ids())
    and id not in (select public.reported_ids())
  );

alter policy "replies read" on public.review_replies
  using (
    user_id not in (select public.hidden_user_ids())
    and id not in (select public.reported_ids())
  );

alter policy "likes read" on public.review_likes
  using (user_id not in (select public.hidden_user_ids()));

-- An edge is hidden if EITHER end is a blocked person, so a follower list never
-- shows someone you have blocked and the counts agree with the lists.
alter policy "follows readable" on public.follows
  using (
    follower_id not in (select public.hidden_user_ids())
    and followee_id not in (select public.hidden_user_ids())
  );

-- ---------------------------------------------------------------------------
-- 5. Write policies: neither side can reach the other
-- ---------------------------------------------------------------------------
-- The checks are written in the POSITIVE form ("the target exists AND its author
-- is not hidden") on purpose. The negative form -- `not exists (... where the
-- author is hidden)` -- is vacuously true when the row is invisible, and the
-- read policies above make exactly those rows invisible. It would have allowed
-- the very insert it was written to refuse.
drop policy "follows own insert" on public.follows;
create policy "follows own insert" on public.follows
  for insert to authenticated
  with check (
    auth.uid() = follower_id
    and followee_id not in (select public.hidden_user_ids())
  );

-- The parent check has to live in a function. A policy on review_replies cannot
-- subquery review_replies itself -- Postgres refuses with "infinite recursion
-- detected in policy for relation" whichever command the policies are for -- so
-- the lookup goes through a SECURITY DEFINER function, which also does not
-- depend on the read policies (a parent the caller cannot see is not one they
-- may answer). It returns a bare boolean, so it discloses nothing beyond yes/no.
create or replace function public.reply_is_reachable(p_reply_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.review_replies
    where id = p_reply_id
      and user_id not in (select public.hidden_user_ids())
  );
$$;

revoke all on function public.reply_is_reachable(uuid) from public, anon, authenticated;
grant execute on function public.reply_is_reachable(uuid) to authenticated;

drop policy "reply own" on public.review_replies;
create policy "reply own" on public.review_replies
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.ratings r
      where r.id = rating_id
        and r.user_id not in (select public.hidden_user_ids())
    )
    and (parent_reply_id is null or public.reply_is_reachable(parent_reply_id))
  );

-- 0006 refused liking your own rating with a NOT EXISTS; folded into the same
-- positive form here, so a like needs a visible rating that is not yours.
drop policy "like own" on public.review_likes;
create policy "like own" on public.review_likes
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.ratings r
      where r.id = rating_id
        and r.user_id <> auth.uid()
        and r.user_id not in (select public.hidden_user_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- 6. block_user
-- ---------------------------------------------------------------------------
-- One transaction: record the block and delete the follows between the pair, in
-- both directions. The deletes fire notify_on_follow's DELETE branch, so the
-- "N people followed you" rows decrement (and vanish at zero) on their own.
--
-- Unblocking is a plain DELETE on `blocks` (the owner may) and deliberately does
-- NOT restore the follows: a block ends the relationship, and lifting it does not
-- get to decide that two people follow each other again.
create or replace function public.block_user(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'block_user: not signed in' using errcode = '28000';
  end if;
  if p_target is null or p_target = me then
    raise exception 'block_user: cannot block yourself' using errcode = '22023';
  end if;

  insert into public.blocks (blocker_id, blocked_id)
  values (me, p_target)
  on conflict do nothing;

  delete from public.follows
  where (follower_id = me and followee_id = p_target)
     or (follower_id = p_target and followee_id = me);
end;
$$;

revoke all on function public.block_user(uuid) from public, anon, authenticated;
grant execute on function public.block_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Notification triggers: nothing new between a blocked pair
-- ---------------------------------------------------------------------------
-- The write policies above already refuse a like, reply or follow between a
-- blocked pair, so these can only fire for a block that lands in between. They
-- are the belt to those braces, and the only thing that stops a NOTIFICATION
-- reaching someone who has blocked the actor.
--
-- notifications that already exist are left alone. The follow row decrements by
-- itself when block_user deletes the edge.
--
-- notify_on_like / notify_on_follow are 0017's bodies verbatim (the
-- `greatest(... , 0)` floor included) plus one condition each; notify_on_reply is
-- 0008's, untouched since.
create or replace function public.notify_on_reply()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  review_author uuid;
  parent_author uuid;
begin
  select user_id into review_author from ratings where id = new.rating_id;

  if review_author is not null
     and review_author <> new.user_id
     and not public.blocked_between(review_author, new.user_id) then
    insert into notifications (user_id, type, actor_id, rating_id, reply_id)
    values (review_author, 'reply', new.user_id, new.rating_id, new.id);
  end if;

  if new.parent_reply_id is not null then
    select user_id into parent_author
      from review_replies where id = new.parent_reply_id;
    if parent_author is not null
       and parent_author <> new.user_id
       and parent_author is distinct from review_author
       and not public.blocked_between(parent_author, new.user_id) then
      insert into notifications (user_id, type, actor_id, rating_id, reply_id)
      values (parent_author, 'reply', new.user_id, new.rating_id, new.id);
    end if;
  end if;

  return new;
end;
$$;

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
    if review_author is null
       or review_author = new.user_id  -- self-likes are blocked anyway; belt and braces
       or public.blocked_between(review_author, new.user_id) then
      return new;
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
    if new.follower_id = new.followee_id  -- the follows CHECK forbids it anyway
       or public.blocked_between(new.follower_id, new.followee_id) then
      return new;
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
