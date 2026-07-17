-- Threaded replies on community reviews. The full tree is stored
-- (parent_reply_id); the UI renders two visual levels. Deleting a reply
-- tombstones it (deleted_at set, body blanked) so children keep context.
-- See docs/adr/0002-threaded-replies-flat-render.md.
create table public.review_replies (
  id              uuid primary key default gen_random_uuid(),
  rating_id       uuid not null references public.ratings (id) on delete cascade,
  parent_reply_id uuid references public.review_replies (id) on delete set null,
  user_id         uuid not null references auth.users (id) on delete cascade,
  body            text not null,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index on public.review_replies (rating_id, created_at);

alter table public.review_replies enable row level security;

create policy "replies read" on public.review_replies
  for select to authenticated using (true);

create policy "reply own" on public.review_replies
  for insert to authenticated with check (auth.uid() = user_id);

-- "Deletion" is an update to the tombstone state; no delete policy exists.
create policy "tombstone own" on public.review_replies
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
