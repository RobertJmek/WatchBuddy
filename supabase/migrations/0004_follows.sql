-- Social graph: asymmetric, instant follows (Twitter/Letterboxd style). One row
-- per directed edge; "mutual" is just both edges existing. Following is an
-- insert, unfollowing a delete -- no approval step. Cascades on account delete.
create table public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  followee_id uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

-- Fast "who do I follow" (by follower) and "who follows them" (by followee).
-- The PK already indexes (follower_id, followee_id); add the reverse lookup.
create index follows_followee_idx on public.follows (followee_id);

alter table public.follows enable row level security;

-- Anyone signed in can read the graph (needed for counts + follower lists).
create policy "follows readable" on public.follows
  for select to authenticated using (true);

-- You may only create/remove your OWN follow edge.
create policy "follows own insert" on public.follows
  for insert to authenticated with check (auth.uid() = follower_id);
create policy "follows own delete" on public.follows
  for delete to authenticated using (auth.uid() = follower_id);

-- Public diary: now that profiles are discoverable, a user's watch history,
-- library and ratings become readable by any authenticated user (Letterboxd
-- default). These are permissive SELECT policies that OR with the existing
-- owner-only "own rows" policies, so reads open up while writes stay owner-only.
create policy "watch data public read" on public.library_items
  for select to authenticated using (true);
create policy "watch data public read" on public.episode_watches
  for select to authenticated using (true);
create policy "watch data public read" on public.movie_watches
  for select to authenticated using (true);
create policy "watch data public read" on public.ratings
  for select to authenticated using (true);
