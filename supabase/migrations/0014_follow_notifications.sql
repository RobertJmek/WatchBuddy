-- "X followed you" notifications. A follow has no rating, so `rating_id` (until
-- now `not null`) becomes nullable and the type CHECK learns 'follow'. Follows
-- aggregate to one row per recipient, the way likes aggregate per (recipient,
-- rating); unfollowing decrements and the row disappears at zero.
--
-- The activity feed is deliberately NOT touched: get_feed already emits 'follow'
-- events but excludes follows *of* the viewer ("those are the viewer's business,
-- surfaced elsewhere") -- this migration is the elsewhere. Including them there
-- too would show the same event twice on the Feed screen.
--
-- See docs/adr/0012-follow-notifications.md (and 0003 for the trigger/Realtime
-- design this follows).

-- --- schema -------------------------------------------------------------
alter table public.notifications alter column rating_id drop not null;

-- Postgres auto-named the inline column check in 0008 `notifications_type_check`.
-- Dropped WITHOUT `if exists` on purpose: a silent no-op here would leave the old
-- constraint in place, still rejecting 'follow', and the failure would only show
-- up at runtime.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('reply', 'like', 'follow'));

-- Replaces the invariant the `not null` used to give us: exactly the follow rows
-- have no rating, and every other type still must have one.
alter table public.notifications add constraint notifications_target_check
  check ((type = 'follow') = (rating_id is null));

-- The column counts followers now as well as likers.
alter table public.notifications rename column like_count to actor_count;

-- Aggregation key, mirroring notifications_like_agg: one follow row per recipient.
create unique index notifications_follow_agg
  on public.notifications (user_id) where (type = 'follow');

-- --- follow notifications (aggregated per recipient) --------------------
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
      actor_count = notifications.actor_count + 1,
      actor_id    = excluded.actor_id,
      created_at  = now(),
      read_at     = null;  -- a new follower re-surfaces the row as unread
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

create trigger trg_notify_on_follow
  after insert or delete on public.follows
  for each row execute function public.notify_on_follow();
