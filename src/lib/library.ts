import { supabase } from '@/lib/supabase';
import { requireViewer, selectMine } from '@/lib/viewer';

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

/**
 * The viewer's own library entry: everything a public one has, plus the two
 * things only the owner can be told — which genres the title carries and what
 * *they* rated it. Filtering needs both; nobody else's library does, which is
 * why this is a separate type from `LibraryEntry` rather than optional fields
 * that would be null half the time.
 */
export type MyLibraryEntry = LibraryEntry & {
  genreIds: number[];
  /** 1–10, or null when the viewer hasn't rated this title. */
  myRating: number | null;
};

/** All of the current user's library items, newest first, with their titles. */
export async function getLibrary(): Promise<MyLibraryEntry[]> {
  const [items, ratings] = await Promise.all([
    selectMine(
      'library_items',
      'id, status, is_favorite, created_at, title:titles(id, tmdb_id, media_type, title, poster_path, release_date, title_genres(genre_id))',
    ).then(({ q }) => q.order('created_at', { ascending: false })),
    // `ratings.entity_id` is a polymorphic uuid with no FK (it can point at a
    // title, a season or an episode), so PostgREST can't nest ratings under
    // library_items — the viewer's title ratings come as their own select and
    // get paired up by title id below.
    selectMine('ratings', 'entity_id, value').then(({ q }) =>
      q.in('entity_type', ['movie', 'show']),
    ),
  ]);
  if (items.error) throw items.error;
  if (ratings.error) throw ratings.error;

  const byTitle = new Map<string, number>(
    (ratings.data ?? []).map((r: { entity_id: string; value: number }) => [
      r.entity_id,
      r.value,
    ]),
  );

  type Row = LibraryEntry & {
    title: (NonNullable<LibraryEntry['title']> & {
      title_genres: { genre_id: number }[] | null;
    }) | null;
  };

  return ((items.data ?? []) as unknown as Row[]).map(({ title, ...rest }) => ({
    ...rest,
    title: title
      ? {
          id: title.id,
          tmdb_id: title.tmdb_id,
          media_type: title.media_type,
          title: title.title,
          poster_path: title.poster_path,
          release_date: title.release_date,
        }
      : null,
    genreIds: (title?.title_genres ?? []).map((g) => g.genre_id),
    myRating: title ? (byTitle.get(title.id) ?? null) : null,
  }));
}

/**
 * Another user's library, for the public profile shelves. Watch data is
 * world-readable under RLS, so this is a plain parametrized read.
 */
export async function getLibraryFor(userId: string): Promise<LibraryEntry[]> {
  const { data, error } = await supabase
    .from('library_items')
    .select(
      'id, status, is_favorite, created_at, updated_at, title:titles(id, tmdb_id, media_type, title, poster_path, release_date)',
    )
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as LibraryEntry[];
}

/** The current user's status for a title, or null if not in their library. */
export async function getLibraryStatus(
  titleId: string,
): Promise<LibraryStatus | null> {
  const { q } = await selectMine('library_items', 'status');
  const { data, error } = await q.eq('title_id', titleId).maybeSingle();
  if (error) throw error;
  return (data?.status as LibraryStatus) ?? null;
}

/** Set/insert the user's status for a title (one row per user+title). */
export async function setLibraryStatus(titleId: string, status: LibraryStatus) {
  const uid = await requireViewer();
  const { error } = await supabase
    .from('library_items')
    .upsert(
      { user_id: uid, title_id: titleId, status },
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
  const { q } = await selectMine('library_items', 'is_favorite');
  const { data, error } = await q.eq('title_id', titleId).maybeSingle();
  if (error) throw error;
  return data?.is_favorite ?? false;
}

/**
 * Toggle the heart. Updates the existing library row; if there is none and the
 * user is favoriting, creates one with status 'watchlist'. RLS scopes the
 * update/insert to the current user.
 */
export async function setFavorite(titleId: string, favorite: boolean) {
  const uid = await requireViewer();
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
      user_id: uid,
      title_id: titleId,
      status: 'watchlist',
      is_favorite: true,
    });
    if (insertError) throw insertError;
  }
}
