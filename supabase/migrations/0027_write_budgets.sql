-- 0027: a ceiling on how fast one account can write.
--
-- From the 2026-11-15 security review. Row-level security decides WHOSE rows an
-- account may write, not how many. With nothing but a signed-in session and the
-- public key, one account could:
--
--   * post replies without limit, each one a notification for its target, and
--     follow / unfollow or like / unlike in a loop to keep re-raising a
--     notification the target had dismissed;
--   * insert rows without limit into the tables that have no natural bound --
--     `episode_watches` and `movie_watches` have no unique key, `ratings.entity_id`
--     and `reports.target_id` have no foreign key -- until the database is full.
--
-- Each of those tables now spends from a token bucket per account, the same
-- `rate_limits` / `consume_rate_limit` the edge functions use (0018). The
-- numbers are Robert's, set well above what the app does on its own:
--
--   bucket      table(s)                         burst     refill
--   w:replies   review_replies                      30     30 / hour
--   w:follows   follows                            100     100 / hour
--   w:likes     review_likes                       200     200 / hour
--   w:reports   reports                             30     30 / day
--   w:watches   episode_watches + movie_watches 100000     20000 / day
--   w:ratings   ratings (new rows only)           2000     2000 / day
--
-- Backward compatible for every build: no column, policy, grant or return shape
-- changes, and a write under the budget behaves exactly as before. Over it, the
-- statement fails as a whole with HTTP 429 and "Too many requests. Try again
-- later.", which every build already shows as a failed save. The importers
-- insert 500 watches per statement, so an import of up to 100,000 watches fits
-- in the burst; a larger one stops and can be resumed as the bucket refills.
--
-- Not metered: the service role and the Dashboard (no user id), updates and
-- deletes, and an upsert that lands on an existing row (re-rating a title).

-- AFTER INSERT ... FOR EACH STATEMENT, so a 500-row import chunk is one spend of
-- 500 rather than 500 spends. Arguments: bucket, capacity, refill amount, refill
-- period in seconds.
--
-- SECURITY DEFINER because consume_rate_limit is executable by the service role
-- only (0019). The subject is always auth.uid(), never a value from the row, so
-- an account can only ever spend its own bucket.
create or replace function public.enforce_write_budget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_capacity double precision := tg_argv[1]::double precision;
  v_rows     bigint;
  v_allowed  boolean;
begin
  if v_uid is null then
    return null;
  end if;
  select count(*) into v_rows from new_rows;
  if v_rows = 0 then
    return null;
  end if;

  if v_rows > v_capacity then
    v_allowed := false;
  else
    -- Fails OPEN, like the edge functions' limiter: a broken accountant must not
    -- be able to stop every write in the app.
    begin
      select l.allowed into v_allowed
        from public.consume_rate_limit(
          tg_argv[0], v_uid, v_rows::double precision, v_capacity,
          tg_argv[2]::double precision / tg_argv[3]::double precision
        ) l;
    exception when others then
      raise warning 'enforce_write_budget(%): %', tg_argv[0], sqlerrm;
      v_allowed := true;
    end;
  end if;

  if v_allowed is false then
    -- PostgREST turns SQLSTATE PTxxx into HTTP status xxx.
    raise exception 'Too many requests. Try again later.' using errcode = 'PT429';
  end if;
  return null;
end;
$$;

-- Trigger functions are not called directly. Revoke BY ROLE (0019); a trigger
-- fires without checking EXECUTE on its function (0023, 0025).
revoke execute on function public.enforce_write_budget() from public, anon, authenticated;

create trigger trg_review_replies_budget
  after insert on public.review_replies
  referencing new table as new_rows
  for each statement execute function public.enforce_write_budget('w:replies', '30', '30', '3600');

create trigger trg_follows_budget
  after insert on public.follows
  referencing new table as new_rows
  for each statement execute function public.enforce_write_budget('w:follows', '100', '100', '3600');

create trigger trg_review_likes_budget
  after insert on public.review_likes
  referencing new table as new_rows
  for each statement execute function public.enforce_write_budget('w:likes', '200', '200', '3600');

create trigger trg_reports_budget
  after insert on public.reports
  referencing new table as new_rows
  for each statement execute function public.enforce_write_budget('w:reports', '30', '30', '86400');

-- One bucket for both watch tables: it bounds what an account adds to the
-- diary, whichever table the rows go to.
create trigger trg_episode_watches_budget
  after insert on public.episode_watches
  referencing new table as new_rows
  for each statement execute function public.enforce_write_budget('w:watches', '100000', '20000', '86400');

create trigger trg_movie_watches_budget
  after insert on public.movie_watches
  referencing new table as new_rows
  for each statement execute function public.enforce_write_budget('w:watches', '100000', '20000', '86400');

-- setRating is an upsert. Rows that land on an existing rating go to the UPDATE
-- transition table, not this one, so changing a score or a review is free.
create trigger trg_ratings_budget
  after insert on public.ratings
  referencing new table as new_rows
  for each statement execute function public.enforce_write_budget('w:ratings', '2000', '2000', '86400');
