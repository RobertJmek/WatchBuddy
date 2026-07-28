-- Swipe a notification away. Until now the only way a notification left the list
-- was time: `getNotifications` drops read rows 48h after they were read, and
-- unread ones never leave. A row you've dealt with kept the top of the Feed.
--
-- Dismissal HIDES, it does not delete: the row keeps existing, so the aggregating
-- triggers below can still count against it and bring it back when there is
-- something new to say. See docs/adr/0014-dismissing-notifications.md.
--
-- Additive on purpose. 0014 renamed a column and broke every installed binary
-- the instant it ran (0015 is the apology). A new nullable column breaks nobody:
-- clients <= v1.14.x simply don't filter on it and keep showing dismissed rows,
-- which is a cosmetic regression on old builds and nothing more.

alter table public.notifications add column dismissed_at timestamptz;

comment on column public.notifications.dismissed_at is
  'Set when the recipient swiped the row away. Filtered out client-side; cleared '
  'by the aggregating triggers when new activity lands on the row. Distinct from '
  'read_at, which only clears the unread badge.';

-- No new RLS policy: 0008''s "mark read" policy is an unrestricted `for update`
-- on the owner''s own rows, so it already covers writing (and clearing)
-- dismissed_at. The policy name is now narrower than what it permits.

-- --- resurfacing --------------------------------------------------------
-- The substance of this migration. Likes and follows aggregate into ONE existing
-- row per (recipient, rating) / per recipient via `on conflict ... do update`.
-- Without clearing dismissed_at there, dismissing "2 people liked your review"
-- would hide the 3rd, 4th and every later like forever — the row is never
-- re-inserted, only updated. Reply notifications are plain inserts (a fresh row
-- with dismissed_at null), so they need nothing.
--
-- Both functions are recreated verbatim apart from that one added assignment;
-- the triggers themselves are untouched.

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
      set actor_count = actor_count - 1
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
      set actor_count = actor_count - 1
      where user_id = old.followee_id and type = 'follow';
    delete from notifications
      where user_id = old.followee_id and type = 'follow' and actor_count <= 0;
    return old;
  end if;
end;
$$;
