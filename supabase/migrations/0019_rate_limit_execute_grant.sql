-- Fix a hole opened by 0018: `consume_rate_limit` is callable by anon.
--
-- 0018 tried to lock the function down with
--
--     revoke all on function public.consume_rate_limit(...) from public;
--     grant execute on function public.consume_rate_limit(...) to service_role;
--
-- and that is not enough. `from public` removes only the implicit grant every
-- function is created with. Supabase additionally runs
-- `alter default privileges in schema public grant all on functions to anon,
-- authenticated, service_role`, so a new function is created with **explicit**
-- grants to those roles, and an explicit grant survives a revoke aimed at
-- PUBLIC. The same migration got the *table* right (`revoke all on
-- public.rate_limits from anon, authenticated`) -- the inconsistency is the bug.
--
-- Impact while it stood: the anon key is embedded in the app and public, so
-- anyone could call the RPC directly and drain any bucket -- including the
-- global `omdb` one, which stops IMDb backfill for everybody -- or insert
-- unbounded junk rows, since bucket and subject are caller-supplied. It reads
-- and writes nothing but `rate_limits`, so there is no data exposure; the
-- damage is to the budget the buckets exist to protect.
--
-- The lesson, worth more than the fix: **`revoke ... from public` does not undo
-- `alter default privileges`.** Name the roles.
revoke execute on function public.consume_rate_limit(
  text, uuid, double precision, double precision, double precision
) from public, anon, authenticated;

-- Idempotent restatement of the one role that should have it.
grant execute on function public.consume_rate_limit(
  text, uuid, double precision, double precision, double precision
) to service_role;

-- Rows created while the function was reachable. Buckets are pure accounting --
-- a missing row is created full on the next spend -- so clearing anything that
-- was not written by the proxy is free. `tmdb-proxy` and `omdb` are the only
-- buckets it uses.
delete from public.rate_limits where bucket not in ('tmdb-proxy', 'omdb');
