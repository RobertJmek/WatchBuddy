-- In-app notifications for review activity. Rows are produced ONLY by the
-- triggers below (no client insert policy): replies are itemized, likes are
-- aggregated to one row per (recipient, rating). Delivered live via Supabase
-- Realtime. See docs/adr/0003-notifications-triggers-realtime.md.
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade, -- recipient
  type       text not null check (type in ('reply', 'like')),
  actor_id   uuid not null references auth.users (id) on delete cascade, -- latest actor
  rating_id  uuid not null references public.ratings (id) on delete cascade,
  reply_id   uuid references public.review_replies (id) on delete cascade,
  like_count integer not null default 1,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index on public.notifications (user_id, created_at desc);
create unique index notifications_like_agg
  on public.notifications (user_id, rating_id) where (type = 'like');

alter table public.notifications enable row level security;

create policy "own read" on public.notifications
  for select to authenticated using (auth.uid() = user_id);

create policy "mark read" on public.notifications
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime delivery (RLS-filtered per recipient).
alter publication supabase_realtime add table public.notifications;

-- --- reply notifications ------------------------------------------------
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

  if review_author is not null and review_author <> new.user_id then
    insert into notifications (user_id, type, actor_id, rating_id, reply_id)
    values (review_author, 'reply', new.user_id, new.rating_id, new.id);
  end if;

  if new.parent_reply_id is not null then
    select user_id into parent_author
      from review_replies where id = new.parent_reply_id;
    if parent_author is not null
       and parent_author <> new.user_id
       and parent_author is distinct from review_author then
      insert into notifications (user_id, type, actor_id, rating_id, reply_id)
      values (parent_author, 'reply', new.user_id, new.rating_id, new.id);
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_notify_on_reply
  after insert on public.review_replies
  for each row execute function public.notify_on_reply();

-- --- like notifications (aggregated per recipient+rating) ---------------
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
      like_count = notifications.like_count + 1,
      actor_id   = excluded.actor_id,
      created_at = now(),
      read_at    = null;
    return new;
  else -- DELETE: decrement; drop the row at zero
    select user_id into review_author from ratings where id = old.rating_id;
    update notifications
      set like_count = like_count - 1
      where user_id = review_author and rating_id = old.rating_id
        and type = 'like';
    delete from notifications
      where user_id = review_author and rating_id = old.rating_id
        and type = 'like' and like_count <= 0;
    return old;
  end if;
end;
$$;

create trigger trg_notify_on_like
  after insert or delete on public.review_likes
  for each row execute function public.notify_on_like();
