-- Cache stamp for episodes so tmdb-proxy can serve them without re-hitting
-- TMDB (same TTL gate the titles table already has via cached_at).
alter table public.episodes
  add column cached_at timestamptz not null default now();
