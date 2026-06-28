-- WatchBuddy initial schema
-- Two layers:
--   1. Catalog cache (shared, populated from TMDB via the Edge Function using the
--      service_role key, which bypasses RLS). Authenticated users may READ it.
--   2. User data (library, diary, ratings), isolated per user by RLS.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Catalog cache
-- ---------------------------------------------------------------------------
create table public.titles (
  id                 uuid primary key default gen_random_uuid(),
  tmdb_id            integer not null,
  media_type         text    not null check (media_type in ('movie', 'tv')),
  imdb_id            text,
  title              text    not null,
  original_title     text,
  overview           text,
  original_language  text,
  release_date       date,
  runtime            integer,                 -- minutes (movie, or avg episode)
  poster_path        text,
  backdrop_path      text,
  origin_country     text,
  tmdb_rating        numeric(4, 2),
  imdb_rating        numeric(4, 2),
  popularity         numeric,
  status             text,                    -- e.g. 'Released', 'Returning Series'
  number_of_seasons  integer,
  number_of_episodes integer,
  cached_at          timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tmdb_id, media_type)
);

create table public.seasons (
  id            uuid primary key default gen_random_uuid(),
  title_id      uuid not null references public.titles (id) on delete cascade,
  tmdb_id       integer,
  season_number integer not null,
  name          text,
  overview      text,
  episode_count integer,
  air_date      date,
  poster_path   text,
  unique (title_id, season_number)
);

create table public.episodes (
  id             uuid primary key default gen_random_uuid(),
  season_id      uuid not null references public.seasons (id) on delete cascade,
  title_id       uuid not null references public.titles (id) on delete cascade,
  tmdb_id        integer,
  season_number  integer not null,
  episode_number integer not null,
  name           text,
  overview       text,
  runtime        integer,
  air_date       date,
  still_path     text,
  unique (season_id, episode_number)
);

create table public.genres (
  id   integer primary key,                   -- TMDB genre id
  name text not null
);

create table public.title_genres (
  title_id uuid    not null references public.titles (id) on delete cascade,
  genre_id integer not null references public.genres (id) on delete cascade,
  primary key (title_id, genre_id)
);

create table public.people (
  id           uuid primary key default gen_random_uuid(),
  tmdb_id      integer unique not null,
  name         text not null,
  profile_path text
);

create table public.credits (
  id          uuid primary key default gen_random_uuid(),
  title_id    uuid not null references public.titles (id) on delete cascade,
  person_id   uuid not null references public.people (id) on delete cascade,
  department  text,                           -- 'cast' or crew department
  job         text,                           -- 'Director', 'Actor', ...
  role        text,                           -- character name for cast
  sort_order  integer,
  unique (title_id, person_id, job)
);

create table public.networks (
  id        integer primary key,              -- TMDB network id
  name      text,
  logo_path text
);

create table public.title_networks (
  title_id   uuid    not null references public.titles (id) on delete cascade,
  network_id integer not null references public.networks (id) on delete cascade,
  primary key (title_id, network_id)
);

create index on public.seasons (title_id);
create index on public.episodes (title_id);
create index on public.episodes (season_id);
create index on public.title_genres (genre_id);
create index on public.credits (person_id);

-- ---------------------------------------------------------------------------
-- User data
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text unique,
  display_name text,
  avatar_url   text,
  bio          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.library_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title_id     uuid not null references public.titles (id) on delete cascade,
  status       text not null check (status in
                 ('watchlist', 'watching', 'completed', 'dropped', 'on_hold')),
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, title_id)
);

create table public.episode_watches (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  episode_id uuid not null references public.episodes (id) on delete cascade,
  title_id   uuid not null references public.titles (id) on delete cascade,
  watched_at timestamptz not null default now(),
  is_rewatch boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.movie_watches (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title_id   uuid not null references public.titles (id) on delete cascade,
  watched_at timestamptz not null default now(),
  is_rewatch boolean not null default false,
  created_at timestamptz not null default now()
);

-- Generic ratings. entity_id points at titles/seasons/episodes depending on
-- entity_type; kept generic (no FK) so per-episode ratings can be enabled later
-- without a migration.
create table public.ratings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  entity_type text not null check (entity_type in ('movie', 'show', 'season', 'episode')),
  entity_id   uuid not null,
  value       smallint not null check (value between 1 and 10),
  review      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, entity_type, entity_id)
);

create index on public.library_items (user_id);
create index on public.episode_watches (user_id, watched_at);
create index on public.movie_watches (user_id, watched_at);
create index on public.ratings (user_id);

-- updated_at triggers
create trigger trg_titles_updated        before update on public.titles        for each row execute function public.set_updated_at();
create trigger trg_profiles_updated      before update on public.profiles      for each row execute function public.set_updated_at();
create trigger trg_library_items_updated before update on public.library_items for each row execute function public.set_updated_at();
create trigger trg_ratings_updated       before update on public.ratings       for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- New-user trigger: create a profile row whenever an auth user is created
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
-- Catalog: readable by any authenticated user; writes only via service_role
-- (which bypasses RLS), so no write policies are defined.
alter table public.titles         enable row level security;
alter table public.seasons        enable row level security;
alter table public.episodes       enable row level security;
alter table public.genres         enable row level security;
alter table public.title_genres   enable row level security;
alter table public.people         enable row level security;
alter table public.credits        enable row level security;
alter table public.networks       enable row level security;
alter table public.title_networks enable row level security;

create policy "catalog read" on public.titles         for select to authenticated using (true);
create policy "catalog read" on public.seasons        for select to authenticated using (true);
create policy "catalog read" on public.episodes       for select to authenticated using (true);
create policy "catalog read" on public.genres         for select to authenticated using (true);
create policy "catalog read" on public.title_genres   for select to authenticated using (true);
create policy "catalog read" on public.people         for select to authenticated using (true);
create policy "catalog read" on public.credits        for select to authenticated using (true);
create policy "catalog read" on public.networks       for select to authenticated using (true);
create policy "catalog read" on public.title_networks for select to authenticated using (true);

-- Profiles: readable by all authenticated users (social-ready); writable only
-- by the owner.
alter table public.profiles enable row level security;
create policy "profiles readable"   on public.profiles for select to authenticated using (true);
create policy "profiles own insert" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles own update" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- User data: full CRUD restricted to the owner.
alter table public.library_items   enable row level security;
alter table public.episode_watches enable row level security;
alter table public.movie_watches   enable row level security;
alter table public.ratings         enable row level security;

create policy "own rows" on public.library_items   for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.episode_watches for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.movie_watches   for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.ratings         for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
