-- 0025: two findings from Supabase's security advisors (2026-11-10).
--
-- 1. Five SECURITY DEFINER trigger functions were executable by `anon` and
--    `authenticated`, because Supabase's default privileges grant EXECUTE on
--    every new function. Postgres refuses to run a trigger function outside a
--    trigger, so this was not exploitable, but nothing should hold the grant.
--    A trigger fires without checking EXECUTE on its function (0023 relies on
--    the same rule), so every trigger keeps working.
-- 2. `set_updated_at` had no fixed search_path. Its body only calls now().
--
-- Backward compatible: no client calls any of these as an RPC (they return
-- `trigger`, so PostgREST could never run them), and no table, column, policy
-- or callable function changes. The SECURITY DEFINER functions the app does
-- call or that policies evaluate as the user (block_user, hidden_user_ids,
-- reply_is_reachable, reported_ids) keep their grants on purpose.

-- By role name, never only `from public` (see 0019).
revoke execute on function public.delete_ratings_for_entity() from public, anon, authenticated;
revoke execute on function public.handle_new_user()           from public, anon, authenticated;
revoke execute on function public.notify_on_follow()          from public, anon, authenticated;
revoke execute on function public.notify_on_like()            from public, anon, authenticated;
revoke execute on function public.notify_on_reply()           from public, anon, authenticated;

alter function public.set_updated_at() set search_path = '';
