#!/bin/bash
# Backend performance snapshot of the linked Supabase project. READ-ONLY: every
# SQL step is a SELECT or an EXPLAIN ANALYZE of a read, and the steps that run as
# a user do so inside a read-only transaction. No row data is collected, only
# statistics, normalized query texts, plans and timings.
#
#   bash scripts/perf-snapshot.sh [output-dir]
#   PERF_DB_URL=postgresql://... bash scripts/perf-snapshot.sh   # a local database, through psql
#
# It reads production with the CLI's privileged login, so a person runs it, not
# an agent. Output goes outside the repo (default: $TMPDIR/watchbuddy-perf-<time>),
# one file per step; the .log files hold the CLI's stderr.
#
# How it works: `supabase db query --linked` runs several statements as one
# transaction and returns the last result, which is what lets a step switch to
# the `authenticated` role and a user's JWT claims before its EXPLAIN.

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-${TMPDIR:-/tmp}/watchbuddy-perf-$(date +%Y%m%d-%H%M%S)}"
PSQL="${PSQL:-psql}"
mkdir -p "$OUT"
cd "$REPO" || exit 1

n=0
run_sql() { # name, sql
  n=$((n + 1))
  printf '[%02d] %s\n' "$n" "$1"
  if [ -n "$PERF_DB_URL" ]; then
    "$PSQL" "$PERF_DB_URL" -X -q --csv -c "$2" >"$OUT/$1.csv" 2>"$OUT/$1.log"
  else
    supabase db query --linked -o csv "$2" >"$OUT/$1.csv" 2>"$OUT/$1.log"
  fi
}

# Statements that make the rest of the call run as one user, through RLS, the way
# PostgREST does. $1 is a query returning that user's id.
as_user() {
  echo "set local transaction read only;
do \$\$ begin perform set_config('request.jwt.claims', (select json_build_object('sub', x.id, 'role', 'authenticated')::text from ($1) x(id)), true); end \$\$;
set local role authenticated;"
}
# Worst cases: the user with the most episode watches, and the one following the most people.
HEAVY="(select user_id from public.episode_watches group by user_id order by count(*) desc limit 1)"
AS_USER="$(as_user "select user_id from public.episode_watches group by user_id order by count(*) desc limit 1")"
AS_FOLLOWER="$(as_user "select follower_id from public.follows group by follower_id order by count(*) desc limit 1")"

# A SQL function shows up in a plan as one opaque node. To see inside it, take its
# body from the migration that last defined it and substitute the parameters.
body() { # migration file, function name, name=value ...
  python3 - "$@" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
start = src.rindex("create or replace function public.%s(" % sys.argv[2])
text = src[src.index("as $$", start) + 5 : src.index("$$;", start)]
for pair in sys.argv[3:]:
    name, value = pair.split("=", 1)
    text = re.sub(r"\b%s\b" % re.escape(name), value, text)
print(text.strip().rstrip(";"))
PY
}
STATS_BODY="$(body supabase/migrations/0013_get_stats_rpc.sql get_stats "p_user_id=auth.uid()" "p_tz='Europe/Bucharest'" "p_now=now()")"
FEED_BODY="$(body supabase/migrations/0021_review_findings.sql get_feed "p_limit=30" "p_before=null::timestamptz")"

EX="explain (analyze, buffers)"
# --- 0. does the API accept several statements in one call? -----------------
run_sql 00_preflight_single "select 1 as single_ok"
run_sql 00_preflight_multi "select 1 as first_statement; select 2 as second_statement"
run_sql 00_preflight_identity "$AS_USER select current_user as role_now, (auth.uid() is not null) as has_uid, current_setting('transaction_read_only') as read_only"

# --- 1. environment and scale ----------------------------------------------
run_sql 01_settings "select version() as version, pg_size_pretty(pg_database_size(current_database())) as db_size, current_setting('shared_buffers') as shared_buffers, current_setting('work_mem') as work_mem, current_setting('effective_cache_size') as effective_cache_size, current_setting('max_connections') as max_connections, current_setting('track_functions') as track_functions, current_setting('random_page_cost') as random_page_cost, (select stats_reset from pg_stat_database where datname = current_database()) as stats_reset, (select count(*) from pg_stat_activity) as connections_now"

run_sql 02_per_user_scale "select 'episode_watches' as t, count(*) as users, max(c) as max_rows, percentile_disc(0.5) within group (order by c) as median_rows, sum(c) as total from (select count(*) c from public.episode_watches group by user_id) x union all select 'movie_watches', count(*), max(c), percentile_disc(0.5) within group (order by c), sum(c) from (select count(*) c from public.movie_watches group by user_id) x union all select 'library_items', count(*), max(c), percentile_disc(0.5) within group (order by c), sum(c) from (select count(*) c from public.library_items group by user_id) x union all select 'follows (per follower)', count(*), max(c), percentile_disc(0.5) within group (order by c), sum(c) from (select count(*) c from public.follows group by follower_id) x"

run_sql 03_tables "select relname, n_live_tup, n_dead_tup, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch, n_tup_ins, n_tup_upd, n_tup_hot_upd, n_tup_del, pg_size_pretty(pg_total_relation_size(relid)) as total_size, last_autovacuum, last_autoanalyze from pg_stat_user_tables where schemaname = 'public' order by pg_total_relation_size(relid) desc"

run_sql 04_indexes "select s.relname as tbl, s.indexrelname as idx, s.idx_scan, s.idx_tup_read, pg_size_pretty(pg_relation_size(s.indexrelid)) as size, i.indexdef from pg_stat_user_indexes s join pg_indexes i on i.schemaname = s.schemaname and i.indexname = s.indexrelname where s.schemaname = 'public' order by s.relname, s.indexrelname"

# --- 2. what the app's own queries cost (pg_stat_statements) ----------------
STMT_COLS="r.rolname as role, s.calls, round(s.total_exec_time::numeric, 1) as total_ms, round(s.mean_exec_time::numeric, 2) as mean_ms, round(s.max_exec_time::numeric, 1) as max_ms, round(s.stddev_exec_time::numeric, 1) as stddev_ms, s.rows, s.shared_blks_hit as blks_hit, s.shared_blks_read as blks_read, left(regexp_replace(s.query, '\s+', ' ', 'g'), 700) as query"
STMT_FROM="from extensions.pg_stat_statements s join pg_roles r on r.oid = s.userid where r.rolname in ('authenticated', 'anon', 'service_role', 'authenticator') and s.query !~* '^\s*(set|show|begin|commit|rollback|select set_config|discard|listen|notify)'"

run_sql 05_app_queries_by_total "select $STMT_COLS $STMT_FROM order by s.total_exec_time desc limit 40"
run_sql 06_app_queries_by_mean "select $STMT_COLS $STMT_FROM and s.calls >= 5 order by s.mean_exec_time desc limit 30"
run_sql 07_app_queries_by_max "select $STMT_COLS $STMT_FROM order by s.max_exec_time desc limit 20"
run_sql 08_time_by_role "select r.rolname as role, count(*) as statements, sum(s.calls) as calls, round(sum(s.total_exec_time)::numeric / 1000, 1) as total_s from extensions.pg_stat_statements s join pg_roles r on r.oid = s.userid group by 1 order by 4 desc"
run_sql 09_functions "select schemaname, funcname, calls, round(total_time::numeric, 1) as total_ms, round(self_time::numeric, 1) as self_ms, round((total_time / nullif(calls, 0))::numeric, 2) as mean_ms from pg_stat_user_functions order by total_time desc limit 30"

# --- 3. the heavy reads, timed as the heaviest user through RLS -------------
# Three runs each: the first may include a cold cache, the others are warm.
for i in 1 2 3; do
  run_sql "10_get_stats_run$i" "$AS_USER $EX select public.get_stats(auth.uid(), 'Europe/Bucharest')"
  run_sql "11_get_feed_run$i" "$AS_FOLLOWER $EX select * from public.get_feed(30, null)"
done

run_sql 12_library_list "$AS_USER $EX select li.id, li.status, li.is_favorite, li.created_at, t.id, t.tmdb_id, t.media_type, t.title, t.poster_path, t.release_date, (select array_agg(g.genre_id) from public.title_genres g where g.title_id = t.id) from public.library_items li join public.titles t on t.id = li.title_id where li.user_id = auth.uid() order by li.created_at desc, li.id"

run_sql 13_diary_page "$AS_USER $EX select w.id, w.watched_at, e.season_number, e.episode_number, e.name, t.title, t.poster_path from public.episode_watches w join public.episodes e on e.id = w.episode_id join public.titles t on t.id = w.title_id where w.user_id = auth.uid() order by w.watched_at desc limit 50"

run_sql 14_all_my_episode_watches "$AS_USER $EX select w.id, w.episode_id, w.title_id, w.watched_at from public.episode_watches w where w.user_id = auth.uid() order by w.watched_at desc, w.id limit 1000"

run_sql 15_title_watches "$AS_USER $EX select w.episode_id from public.episode_watches w where w.user_id = auth.uid() and w.title_id = (select title_id from public.episode_watches where user_id = auth.uid() group by title_id order by count(*) desc limit 1)"

run_sql 16_rls_unscoped_count "$AS_USER $EX select count(*) from public.episode_watches"

run_sql 17_hidden_user_ids "$AS_USER $EX select * from public.hidden_user_ids()"

# --- 4. the same RPC without RLS (owner role): the difference is RLS cost ---
run_sql 20_get_stats_as_owner "$EX select public.get_stats($HEAVY, 'Europe/Bucharest')"

# --- 5. cost of the 0023 trigger's helper for the biggest show --------------
run_sql 21_watched_title_status "$EX select public.watched_title_status(x.user_id, x.title_id) from (select user_id, title_id from public.episode_watches where user_id = $HEAVY group by user_id, title_id order by count(*) desc limit 20) x"

# --- 6. inside the two RPCs ---------------------------------------------------
run_sql 22_get_stats_body "$AS_USER $EX $STATS_BODY"
run_sql 23_get_feed_body "$AS_FOLLOWER $EX $FEED_BODY"
run_sql 24_feed_context "$AS_FOLLOWER select (select count(*) from public.follows where follower_id = auth.uid()) as followees, (select count(*) from public.get_feed(30, null)) as feed_rows"

# --- 7. Supabase's own advisors ---------------------------------------------
if [ -z "$PERF_DB_URL" ]; then
  n=$((n + 1)); printf '[%02d] advisors\n' "$n"
  supabase db advisors --linked --type all --level info >"$OUT/30_advisors.txt" 2>&1

  # --- 8. edge function latency, as the app calls it (anon key, read paths) --
  # Two samples each, 16 tokens in all: signed-out callers share one bucket of 30
  # (+1/s), so a longer burst here turns into 429s for them.
  n=$((n + 1)); printf '[%02d] edge function latency\n' "$n"
  URL=$(grep '^EXPO_PUBLIC_SUPABASE_URL=' .env | cut -d= -f2-)
  KEY=$(grep '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' .env | cut -d= -f2-)
  : >"$OUT/40_edge_latency.txt"
  hit() { # label, body, times
    for _ in $(seq "$3"); do
      curl -s -o /dev/null -w "$1 http=%{http_code} total=%{time_total}s ttfb=%{time_starttransfer}s\n" \
        -X POST "$URL/functions/v1/tmdb-proxy" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
        -H 'content-type: application/json' -d "$2" >>"$OUT/40_edge_latency.txt"
    done
  }
  hit trending_legacy '{"action":"trending"}' 2
  hit trending_page '{"action":"trending","media_type":"tv","page":1}' 2
  hit title_cached_tv '{"action":"title","tmdb_id":1396,"media_type":"tv"}' 2
  hit season_cached '{"action":"season","tmdb_id":1396,"season_number":1}' 2
  hit search '{"action":"search","q":"batman"}' 2
fi

echo
echo "Done. Output: $OUT"
