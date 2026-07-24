-- Server-side statistics aggregation. Replaces the client-side getStats() fan-out
-- (which pulled every watch + ~16 credit rows/title + genres/networks/library to the
-- device and reduced in JS). Returns only small numeric/keyed aggregates; the client
-- formats locale/tz labels (month names, "12 Aug 2024", status labels).
--
-- p_tz  : the device IANA timezone, so day/month/year bucketing matches the client's
--         local-time Date math (incl. the release_date UTC-midnight quirk).
-- p_now : injectable "now" (defaults to now()) for deterministic testing.
create or replace function public.get_stats(
  p_user_id uuid,
  p_tz text default 'UTC',
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with
  -- Every watch (episode + movie) with its per-watch minutes and local wall-clock time.
  watches as (
    select ew.title_id,
           ew.watched_at,
           (ew.watched_at at time zone p_tz) as lt,
           coalesce(ep.runtime, t.runtime, 0) as minutes,
           'episode'::text as kind,
           ew.episode_id
    from episode_watches ew
    join titles t on t.id = ew.title_id
    left join episodes ep on ep.id = ew.episode_id
    where ew.user_id = p_user_id
    union all
    select mw.title_id,
           mw.watched_at,
           (mw.watched_at at time zone p_tz),
           coalesce(t.runtime, 0),
           'movie',
           null
    from movie_watches mw
    join titles t on t.id = mw.title_id
    where mw.user_id = p_user_id
  ),
  watched_titles as (select distinct title_id from watches),
  title_meta as (
    select t.id as title_id, t.runtime, t.original_language, t.release_date, t.media_type
    from titles t
    where t.id in (select title_id from watched_titles)
  ),

  -- Genres over distinct watched titles (each title contributes each genre once).
  genre_counts as (
    select g.name, count(*)::int as c
    from title_genres tg join genres g on g.id = tg.genre_id
    where tg.title_id in (select title_id from watched_titles)
    group by g.name
  ),

  -- Credits over distinct watched titles: Director vs everyone-else (matches the TS
  -- `job === 'Director' ? directors : actors` split, counting per credit row).
  credit_people as (
    select p.name, coalesce(c.job = 'Director', false) as is_director
    from credits c join people p on p.id = c.person_id
    where c.title_id in (select title_id from watched_titles) and p.name is not null
  ),
  director_counts as (select name, count(*)::int c from credit_people where is_director group by name),
  actor_counts as (select name, count(*)::int c from credit_people where not is_director group by name),

  -- Rated movie/show titles (for taste insights).
  title_ratings as (
    select r.entity_id as title_id, r.value
    from ratings r
    where r.user_id = p_user_id and r.entity_type in ('movie', 'show')
  ),
  genre_rating as (
    select g.name, sum(tr.value)::numeric as s, count(*)::int as cnt
    from title_ratings tr
    join title_genres tg on tg.title_id = tr.title_id
    join genres g on g.id = tg.genre_id
    group by g.name
  ),

  -- Most rewatched: a movie's watch count, or a show's max single-episode count.
  movie_counts as (select title_id, count(*)::int c from watches where kind = 'movie' group by title_id),
  episode_counts as (
    select title_id, max(c)::int c
    from (
      select title_id, episode_id, count(*)::int c
      from watches where kind = 'episode' and episode_id is not null
      group by title_id, episode_id
    ) e
    group by title_id
  ),
  times_agg as (
    select title_id, max(c)::int c
    from (select * from movie_counts union all select * from episode_counts) u
    group by title_id
  ),

  -- Distinct-title media split + TV titles for networks.
  media as (
    select
      count(*) filter (where media_type = 'movie')::int as movies,
      count(*) filter (where media_type = 'tv')::int as tv
    from title_meta
  ),
  network_counts as (
    select n.name, count(*)::int c
    from title_networks tn join networks n on n.id = tn.network_id
    where tn.title_id in (select title_id from title_meta where media_type = 'tv')
      and n.name is not null
    group by n.name
  ),

  -- Decades (replicate JS `new Date('YYYY-MM-DD')` = UTC midnight, then local year).
  decade_counts as (
    select (floor(extract(year from ((release_date::text || 'T00:00:00Z')::timestamptz at time zone p_tz)) / 10) * 10)::int as decade,
           count(*)::int c
    from title_meta where release_date is not null
    group by 1
  ),
  language_counts as (
    select original_language as code, count(*)::int c
    from title_meta where original_language is not null
    group by 1
  ),

  -- Ratings (ALL entity types, matching the TS distribution/average/count).
  all_ratings as (select value from ratings where user_id = p_user_id),
  rating_agg as (
    select count(*)::int as cnt,
           case when count(*) > 0 then avg(value)::float else null end as average
    from all_ratings
  ),
  dist as (
    select coalesce(jsonb_agg(cc order by v), '[]'::jsonb) as arr
    from (select gs.v, count(ar.value)::int cc
          from generate_series(0, 10) gs(v)
          left join all_ratings ar on ar.value = gs.v
          group by gs.v) d
  ),

  -- Library status (raw values; client maps to labels/order).
  library_status as (
    select status, count(*)::int c from library_items where user_id = p_user_id group by status
  ),

  -- Totals.
  totals as (
    select
      count(*) filter (where kind = 'movie')::int as total_movie,
      count(*) filter (where kind = 'episode')::int as total_episode,
      coalesce(sum(minutes), 0)::bigint as total_minutes
    from watches
  ),
  -- This local year.
  ty as (
    select
      coalesce(sum(minutes) filter (where extract(year from lt) = extract(year from (p_now at time zone p_tz))), 0)::bigint as minutes,
      count(*) filter (where kind = 'movie' and extract(year from lt) = extract(year from (p_now at time zone p_tz)))::int as movies,
      count(*) filter (where kind = 'episode' and extract(year from lt) = extract(year from (p_now at time zone p_tz)))::int as episodes
    from watches
  ),

  -- Month buckets (local); series is the last 12, busiestMonth is over all.
  month_counts as (
    select extract(year from lt)::int y, extract(month from lt)::int m, count(*)::int c
    from watches group by 1, 2
  ),
  monthly as (
    select coalesce(jsonb_agg(jsonb_build_object('year', gy, 'month', gm, 'count', coalesce(mc.c, 0)) order by ord), '[]'::jsonb) arr
    from (
      select ord,
             extract(year from d)::int gy,
             extract(month from d)::int gm
      from generate_series(0, 11) ord,
           lateral (select date_trunc('month', (p_now at time zone p_tz)) - ((11 - ord) || ' months')::interval as d) dd
    ) slots
    left join month_counts mc on mc.y = slots.gy and mc.m = slots.gm
  ),
  busiest_month as (
    select jsonb_build_object('year', y, 'month', m, 'count', c) obj
    from month_counts order by c desc, y, m limit 1
  ),

  -- Weekday + day buckets.
  weekday_counts as (select extract(dow from lt)::int dow, count(*)::int c from watches group by 1),
  busiest_weekday as (select dow from weekday_counts order by c desc, dow limit 1),
  day_counts as (select (lt::date) d, count(*)::int c from watches group by 1),
  biggest_day as (
    select jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'), 'count', c) obj
    from day_counts order by c desc, d limit 1
  ),

  -- Streaks over distinct local watch-days.
  islands as (
    select d, (d - (row_number() over (order by d))::int) as grp from day_counts
  ),
  longest_streak as (
    select coalesce(max(cnt), 0)::int v from (select grp, count(*)::int cnt from islands group by grp) g
  ),
  start_day as (
    select case
      when exists (select 1 from day_counts where d = (p_now at time zone p_tz)::date)
        then (p_now at time zone p_tz)::date
      when exists (select 1 from day_counts where d = (p_now at time zone p_tz)::date - 1)
        then (p_now at time zone p_tz)::date - 1
      else null end as sd
  ),
  current_streak as (
    select coalesce(count(*) filter (where is_run), 0)::int v
    from (
      select (dc.d = (select sd from start_day) - ((row_number() over (order by dc.d desc)) - 1) * interval '1 day') as is_run
      from day_counts dc
      where dc.d <= (select sd from start_day)
    ) s
  )

select jsonb_build_object(
  'distinctTitles', (select count(*)::int from watched_titles),
  'totalMovieWatches', (select total_movie from totals),
  'totalEpisodeWatches', (select total_episode from totals),
  'totalMinutes', (select total_minutes from totals),
  'thisYear', jsonb_build_object(
    'minutes', (select minutes from ty),
    'movies', (select movies from ty),
    'episodes', (select episodes from ty)
  ),
  'topGenres', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', c) order by c desc, name), '[]'::jsonb)
                from (select name, c from genre_counts order by c desc, name limit 8) x),
  'topDirectors', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', c) order by c desc, name), '[]'::jsonb)
                   from (select name, c from director_counts order by c desc, name limit 6) x),
  'topActors', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', c) order by c desc, name), '[]'::jsonb)
                from (select name, c from actor_counts order by c desc, name limit 6) x),
  'ratingByGenre', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'avg', avg) order by avg desc, name), '[]'::jsonb)
                    from (select name, (s / cnt)::float avg from genre_rating order by (s / cnt) desc, name limit 6) x),
  'topRated', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'value', value) order by value desc, name), '[]'::jsonb)
               from (select coalesce(t.title, 'Unknown') name, tr.value
                     from title_ratings tr left join titles t on t.id = tr.title_id
                     order by tr.value desc, coalesce(t.title, 'Unknown') limit 5) x),
  'mostRewatched', (select jsonb_build_object('name', coalesce(t.title, 'Unknown'), 'times', ta.c)
                    from times_agg ta left join titles t on t.id = ta.title_id
                    where ta.c >= 2 order by ta.c desc, coalesce(t.title, 'Unknown') limit 1),
  'mediaSplit', (select jsonb_build_object('movies', movies, 'tv', tv) from media),
  'libraryStatus', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c)), '[]'::jsonb) from library_status),
  'topNetworks', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', c) order by c desc, name), '[]'::jsonb)
                  from (select name, c from network_counts order by c desc, name limit 6) x),
  'decades', (select coalesce(jsonb_agg(jsonb_build_object('decade', decade, 'count', c) order by decade), '[]'::jsonb) from decade_counts),
  'languages', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'count', c) order by c desc, code), '[]'::jsonb)
                from (select code, c from language_counts order by c desc, code limit 6) x),
  'rating', jsonb_build_object(
    'count', (select cnt from rating_agg),
    'average', (select average from rating_agg),
    'distribution', (select arr from dist)
  ),
  'monthly', (select arr from monthly),
  'patterns', jsonb_build_object(
    'busiestWeekday', (select dow from busiest_weekday),
    'biggestDay', (select obj from biggest_day),
    'currentStreak', (select v from current_streak),
    'longestStreak', (select v from longest_streak),
    'busiestMonth', (select obj from busiest_month)
  )
);
$$;

grant execute on function public.get_stats(uuid, text, timestamptz) to authenticated;
