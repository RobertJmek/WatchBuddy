-- Favorites: a per-user heart on a library item. Kept on library_items so a
-- favorite is a subset of the user's library (removing the library row drops
-- the heart). Hearting a title with no status auto-creates a 'watchlist' row.
alter table public.library_items
  add column if not exists is_favorite boolean not null default false;
