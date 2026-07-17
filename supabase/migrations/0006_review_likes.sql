-- Likes on community reviews. A like endorses another user's written review;
-- it references the ratings row (reviews are text on ratings), and RLS blocks
-- liking your own rating. See docs/adr/0001-review-likes-on-rating-rows.md.
create table public.review_likes (
  rating_id  uuid not null references public.ratings (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (rating_id, user_id)
);

create index on public.review_likes (rating_id);

alter table public.review_likes enable row level security;

create policy "likes read" on public.review_likes
  for select to authenticated using (true);

create policy "like own" on public.review_likes
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and not exists (
      select 1 from public.ratings r
      where r.id = rating_id and r.user_id = auth.uid()
    )
  );

create policy "unlike own" on public.review_likes
  for delete to authenticated using (auth.uid() = user_id);
