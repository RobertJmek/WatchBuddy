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
  is_favorite: boolean;
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('library_items')
    .select(
      'id, status, is_favorite, created_at, title:titles(id, tmdb_id, media_type, title, poster_path, release_date)',
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as LibraryEntry[];
}

/** The current user's status for a title, or null if not in their library. */
export async function getLibraryStatus(
  titleId: string,
): Promise<LibraryStatus | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('library_items')
    .select('status')
    .eq('user_id', user.id)
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

/** Whether the title is currently favorited (false if not in the library). */
export async function getFavorite(titleId: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('library_items')
    .select('is_favorite')
    .eq('user_id', user.id)
    .eq('title_id', titleId)
    .maybeSingle();
  if (error) throw error;
  return data?.is_favorite ?? false;
}

/**
 * Toggle the heart. Updates the existing library row; if there is none and the
 * user is favoriting, creates one with status 'watchlist'. RLS scopes the
 * update/insert to the current user.
 */
export async function setFavorite(titleId: string, favorite: boolean) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: updated, error: updateError } = await supabase
    .from('library_items')
    .update({ is_favorite: favorite })
    .eq('title_id', titleId)
    .select('id');
  if (updateError) throw updateError;
  if ((updated?.length ?? 0) > 0) return;

  // No library row yet — only meaningful when turning the heart on.
  if (favorite) {
    const { error: insertError } = await supabase.from('library_items').insert({
      user_id: user.id,
      title_id: titleId,
      status: 'watchlist',
      is_favorite: true,
    });
    if (insertError) throw insertError;
  }
}
