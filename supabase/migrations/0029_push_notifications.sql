-- 0029: push notifications (ADR 0039).
--
-- Every in-app notification also reaches the recipient's phones as a push, if
-- they allowed it. The rule is simple because notifications already have one
-- source: the triggers on review_replies / review_likes / follows write
-- `notifications`, so a trigger on `notifications` sees every one of them, blocks
-- included (those triggers already skip a blocked pair).
--
--   notifications row → push_notification() → pg_net → Expo Push API → APNs / FCM
--
-- Postgres calls Expo directly; there is no edge function in between. pg_net is
-- asynchronous (the request is queued and sent after commit), so a slow or
-- failing Expo never slows or fails the like/reply/follow that caused it, and the
-- whole send sits in an exception block for the same reason.
--
-- Backward compatible (rule 0): a new table, a new RPC, a new nullable column and
-- new triggers. Nothing a shipped build reads, writes or calls changes shape.
-- Builds without push never register a token, so nothing is sent for them.

create extension if not exists pg_net with schema extensions;

-- --- tokens --------------------------------------------------------------
-- One row per phone (an Expo push token), with that phone's choices. Per device
-- on purpose: it mirrors the system setting it sits next to, and a phone that
-- has no permission has no row to show switches for.
create table public.push_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  replies    boolean not null default true,
  likes      boolean not null default true,
  follows    boolean not null default true,
  updated_at timestamptz not null default now()
);

create index on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy "own push tokens" on public.push_tokens
  for select to authenticated using (user_id = auth.uid());
create policy "own push tokens update" on public.push_tokens
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own push tokens delete" on public.push_tokens
  for delete to authenticated using (user_id = auth.uid());

-- Explicit grants, after taking back whatever default privileges gave (by role
-- name, 0019). Inserts only through register_push_token; updates only the three
-- switches (0017's column-grant pattern).
revoke all on public.push_tokens from anon, authenticated;
grant select, delete on public.push_tokens to authenticated;
grant update (replies, likes, follows) on public.push_tokens to authenticated;

-- Claim a token for the caller. A token belongs to a phone, not an account: if
-- another account had it (signed out offline, so its row was never deleted) it
-- moves to the caller and starts from the defaults rather than their choices.
-- Plain RLS couldn't do this — the update would have to touch someone else's row.
create function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$' then
    raise exception 'invalid push token' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'invalid platform' using errcode = '22023';
  end if;

  insert into push_tokens (token, user_id, platform)
  values (p_token, me, p_platform)
  on conflict (token) do update set
    platform   = excluded.platform,
    updated_at = now(),
    replies    = case when push_tokens.user_id = me then push_tokens.replies else true end,
    likes      = case when push_tokens.user_id = me then push_tokens.likes   else true end,
    follows    = case when push_tokens.user_id = me then push_tokens.follows else true end,
    user_id    = me;

  -- Ten phones is plenty; keeps a script from piling tokens onto one account.
  delete from push_tokens
  where user_id = me
    and token not in (
      select token from push_tokens where user_id = me
      order by updated_at desc limit 10
    );
end;
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- --- sending --------------------------------------------------------------
-- When the row was last pushed. Likes and follows aggregate into one row
-- (0008/0014), so this is what limits them to one push per row per hour.
alter table public.notifications add column pushed_at timestamptz;

comment on column public.notifications.pushed_at is
  'When this row was last sent as a push (0029). Set by push_notification(); '
  'aggregated rows are pushed at most once an hour.';

create function public.push_notification()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  actor      text;
  title_name text;
  reply_text text;
  to_comment boolean := false;
  others     text := '';
  head       text;
  body       text;
  badge      integer;
  msgs       jsonb;
  headers    jsonb := '{"Content-Type": "application/json"}';
  access     text;
begin
  -- Only something new: an inserted row, or an aggregated row that gained an
  -- actor. Unlike/unfollow (a decrement), read and dismiss never push. A like or
  -- follow is pushed at most once per row per hour; the in-app list stays live.
  if tg_op = 'UPDATE' and old.pushed_at > now() - interval '1 hour' then
    return null;
  end if;

  begin
    select coalesce(nullif(btrim(p.display_name), ''), '@' || p.username, 'Someone')
      into actor
      from profiles p where p.id = new.actor_id;
    actor := coalesce(actor, 'Someone');

    if new.rating_id is not null then
      select t.title into title_name
        from ratings r join titles t on t.id = r.entity_id
        where r.id = new.rating_id;
    end if;

    if new.actor_count > 1 then
      others := format(' and %s %s', new.actor_count - 1,
                       case when new.actor_count = 2 then 'other' else 'others' end);
    end if;

    -- Same words as the in-app row (notification-row.tsx).
    if new.type = 'reply' then
      select rr.parent_reply_id is not null,
             left(regexp_replace(btrim(rr.body), '\s+', ' ', 'g'), 150)
        into to_comment, reply_text
        from review_replies rr where rr.id = new.reply_id;
      head := actor || ' replied to your '
              || case when to_comment then 'comment' else 'review' end
              || coalesce(' on ' || title_name, '');
      body := coalesce(reply_text, '');
    elsif new.type = 'like' then
      body := actor || others || ' liked your review' || coalesce(' on ' || title_name, '');
    else
      body := actor || others || ' followed you';
    end if;

    select count(*) into badge
      from notifications
      where user_id = new.user_id and read_at is null and dismissed_at is null;

    -- ponytail: tokens Expo reports as DeviceNotRegistered are not deleted; they
    -- age out here after 90 days without the app re-registering them. Read the
    -- tickets (net._http_response) if that ever matters.
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'to',        t.token,
             'title',     head,
             'body',      body,
             'data',      jsonb_build_object('url', case
                              when new.type = 'follow' then '/user/' || new.actor_id
                              else '/review/' || new.rating_id end),
             'sound',     'default',
             'badge',     badge,
             'priority',  'high',
             'channelId', case new.type when 'reply' then 'replies'
                                        when 'like' then 'likes' else 'follows' end,
             'threadId',  coalesce('review-' || new.rating_id, 'follows'),
             -- A later push for the same row replaces the earlier one.
             'collapseId', new.id::text
           )))
      into msgs
      from push_tokens t
      where t.user_id = new.user_id
        and t.updated_at > now() - interval '90 days'
        and case new.type when 'reply' then t.replies
                          when 'like'  then t.likes
                          else t.follows end;

    if msgs is null then
      return null;
    end if;

    -- Expo's "enhanced security" token, if one is stored in Vault (ADR 0039).
    begin
      select decrypted_secret into access
        from vault.decrypted_secrets where name = 'expo_access_token';
    exception when others then
      access := null;
    end;
    if access is not null then
      headers := headers || jsonb_build_object('Authorization', 'Bearer ' || access);
    end if;

    perform net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      body    := msgs,
      headers := headers
    );

    -- Fires no trigger of its own: the update trigger below watches actor_count.
    update notifications set pushed_at = now() where id = new.id;
  exception when others then
    -- A push must never fail the like/reply/follow that caused it.
    raise warning 'push_notification(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.push_notification() from public, anon, authenticated;

create trigger trg_push_notification_insert
  after insert on public.notifications
  for each row execute function public.push_notification();

-- An `on conflict do update` that aggregates a like/follow lands here, not in
-- the insert trigger (an AFTER INSERT trigger only sees rows really inserted).
create trigger trg_push_notification_update
  after update of actor_count on public.notifications
  for each row when (new.actor_count > old.actor_count)
  execute function public.push_notification();
