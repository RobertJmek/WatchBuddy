-- A token bucket the edge functions can spend against.
--
-- tmdb-proxy runs with the service-role key and calls two upstreams on the
-- caller's behalf. One of them, OMDb, allows 1,000 requests per DAY across the
-- whole app on the free tier -- a budget any single signed-in user could drain
-- in a couple of minutes of scripted calls, taking IMDb ratings away from
-- everyone else until midnight. Nothing bounded that.
--
-- Buckets live in Postgres rather than in the function because an edge isolate
-- has no memory: it is created per burst of requests, several run at once, and
-- each starts empty. A counter in an isolate limits nothing.

create table public.rate_limits (
  -- What is being limited ('tmdb-proxy', 'omdb'). Free text so tuning and new
  -- buckets do not need a migration.
  bucket     text not null,
  -- Who it is limited for: the caller's auth uid, or the nil uuid for a bucket
  -- that is global rather than per-user (OMDb's daily budget is shared, and
  -- callers presenting only the anon key have no uid to charge).
  subject    uuid not null,
  tokens     double precision not null,
  updated_at timestamptz not null default now(),
  primary key (bucket, subject)
);

comment on table public.rate_limits is
  'Token buckets for edge functions. Written only by consume_rate_limit under the '
  'service role; there is no client access path (RLS on, no policies, grants revoked).';

-- No policies: RLS with none denies everything to anon/authenticated, and the
-- service role bypasses RLS. The revoke is belt and braces against a future
-- `grant all on all tables in schema public`.
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- The one place that touches a row without going through consume_rate_limit:
-- delete-account, which clears the buckets belonging to a uid it is erasing.
-- Buckets deliberately carry no FK to auth.users (the nil uuid stands in for
-- the global ones), so nothing cascades them. Read and delete only -- inventing
-- or topping up a bucket stays the RPC's job.
grant select, delete on public.rate_limits to service_role;

-- ---------------------------------------------------------------------------
-- consume_rate_limit: spend p_cost tokens, or say no
-- ---------------------------------------------------------------------------
-- Classic token bucket: the row stores a balance and when it was last touched,
-- and the refill for the elapsed time is computed at read. A bucket is created
-- full, so a first-time caller is never throttled by an empty row.
--
-- The whole decision is ONE statement on purpose. Read-then-write would let two
-- concurrent requests read the same balance and both spend it -- which is the
-- normal case here, since the app fires several proxy calls at a time. INSERT
-- .. ON CONFLICT DO UPDATE takes a row lock on the conflicting row and
-- re-evaluates its WHERE against the version the winner left behind, so the
-- second caller sees the first caller's spend. When the WHERE fails, no row is
-- updated, nothing is returned, and the request is denied without having
-- consumed anything.
create or replace function public.consume_rate_limit(
  p_bucket            text,
  p_subject           uuid,
  p_cost              double precision,
  p_capacity          double precision,
  p_refill_per_second double precision
)
returns table (
  allowed             boolean,
  tokens_left         double precision,
  retry_after_seconds double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tokens double precision;
begin
  if p_cost <= 0 or p_capacity <= 0 or p_refill_per_second <= 0 then
    raise exception 'consume_rate_limit: cost, capacity and refill must be positive';
  end if;
  if p_cost > p_capacity then
    raise exception 'consume_rate_limit: cost % exceeds capacity %', p_cost, p_capacity;
  end if;

  insert into public.rate_limits (bucket, subject, tokens, updated_at)
  values (p_bucket, p_subject, p_capacity - p_cost, now())
  on conflict (bucket, subject) do update
     set tokens = least(
                    p_capacity,
                    rate_limits.tokens
                      + extract(epoch from (now() - rate_limits.updated_at))
                        * p_refill_per_second
                  ) - p_cost,
         updated_at = now()
   where least(
           p_capacity,
           rate_limits.tokens
             + extract(epoch from (now() - rate_limits.updated_at))
               * p_refill_per_second
         ) >= p_cost
  returning rate_limits.tokens into v_tokens;

  if found then
    return query select true, v_tokens, 0::double precision;
    return;
  end if;

  -- Denied. Nothing was written, so updated_at still marks the last successful
  -- spend and the refill keeps accruing from there; report the wait implied by
  -- the balance as of now.
  select greatest(
           0,
           (p_cost - least(
                       p_capacity,
                       l.tokens
                         + extract(epoch from (now() - l.updated_at))
                           * p_refill_per_second
                     )) / p_refill_per_second
         )
    into v_tokens
    from public.rate_limits l
   where l.bucket = p_bucket and l.subject = p_subject;

  return query select false, 0::double precision, coalesce(v_tokens, 0::double precision);
end;
$$;

comment on function public.consume_rate_limit(text, uuid, double precision, double precision, double precision) is
  'Spend p_cost tokens from the (bucket, subject) bucket. Returns whether the '
  'request is allowed, the balance after it, and -- when denied -- how many '
  'seconds until the bucket holds p_cost again. Capacity and refill rate are '
  'passed per call so tuning lives in the caller, not in a migration.';

-- Only the service role calls this. Exposing it to `authenticated` would let a
-- client drain any bucket, including another user's.
--
-- INCOMPLETE ON ITS OWN -- see 0019. `from public` drops only the implicit grant
-- a function is created with; Supabase's `alter default privileges` also gives
-- anon and authenticated an EXPLICIT grant, which this does not touch. The
-- revoke had to name the roles, the way the table's revoke below already does.
revoke all on function public.consume_rate_limit(text, uuid, double precision, double precision, double precision) from public;
grant execute on function public.consume_rate_limit(text, uuid, double precision, double precision, double precision) to service_role;
