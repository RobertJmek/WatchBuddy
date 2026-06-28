import { supabase } from '@/lib/supabase';

export type LibraryStatus =
  | 'watchlist'
  | 'watching'
  | 'completed'
  | 'dropped'
  | 'on_hold';

export const LIBRARY_STATUSES: { value: LibraryStatus; label: string }[] = [
  { value: 'watchlist', label: 'Watchlist' },
  { value: 'watching', label: 'Watching' },
  { value: 'completed', label: 'Completed' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'dropped', label: 'Dropped' },
];

export type LibraryItem = {
  id: string;
  title_id: string;
  status: LibraryStatus;
  created_at: string;
};

export type LibraryEntry = {
  id: string;
  status: LibraryStatus;
  created_at: string;
  title: {
    id: string;
    tmdb_id: number;
    media_type: 'movie' | 'tv';
    title: string;
    poster_path: string | null;
    release_date: string | null;
  } | null;
};

/** All of the current user's library items, newest first, with their titles. */
export async function getLibrary(): Promise<LibraryEntry[]> {
  const { data, error } = await supabase
    .from('library_items')
    .select(
      'id, status, created_at, title:titles(id, tmdb_id, media_type, title, poster_path, release_date)',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as LibraryEntry[];
}

/** The current user's status for a title, or null if not in their library. */
export async function getLibraryStatus(
  titleId: string,
): Promise<LibraryStatus | null> {
  const { data, error } = await supabase
    .from('library_items')
    .select('status')
    .eq('title_id', titleId)
    .maybeSingle();
  if (error) throw error;
  return (data?.status as LibraryStatus) ?? null;
}

/** Set/insert the user's status for a title (one row per user+title). */
export async function setLibraryStatus(titleId: string, status: LibraryStatus) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { error } = await supabase
    .from('library_items')
    .upsert(
      { user_id: user.id, title_id: titleId, status },
      { onConflict: 'user_id,title_id' },
    );
  if (error) throw error;
}

export async function removeFromLibrary(titleId: string) {
  const { error } = await supabase
    .from('library_items')
    .delete()
    .eq('title_id', titleId);
  if (error) throw error;
}
