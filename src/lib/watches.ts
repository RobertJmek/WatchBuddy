import { setLibraryStatus } from '@/lib/library';
import { supabase } from '@/lib/supabase';
import { currentViewer, requireViewer, selectMine } from '@/lib/viewer';

/** How many times the user has watched each episode of a title. */
export async function getEpisodeWatchCounts(
  titleId: string,
): Promise<Map<string, number>> {
  const { q } = await selectMine('episode_watches', 'episode_id');
  const { data, error } = await q.eq('title_id', titleId);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const id = r.episode_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Log one watch of an episode (a dated diary entry; repeat for rewatches). */
export async function logEpisodeWatch(episodeId: string, titleId: string) {
  const uid = await requireViewer();
  const { error } = await supabase.from('episode_watches').insert({
    user_id: uid,
    episode_id: episodeId,
    title_id: titleId,
  });
  if (error) throw error;
}

/** Delete specific episode-watch rows by id (owner-scoped by RLS). Used by the
 *  Search swipe-to-log undo to reverse *exactly* the rows a swipe inserted. */
export async function removeEpisodeWatchesByIds(ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('episode_watches')
    .delete()
    .in('id', ids);
  if (error) throw error;
}

/** Remove the user's most recent single watch of an episode. */
export async function removeOneEpisodeWatch(episodeId: string) {
  const { q } = await selectMine('episode_watches', 'id');
  const { data, error } = await q
    .eq('episode_id', episodeId)
    .order('watched_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) return;
  const { error: delErr } = await supabase
    .from('episode_watches')
    .delete()
    .eq('id', row.id);
  if (delErr) throw delErr;
}

/**
 * Log one watch for every episode given (a whole-season or whole-series watch).
 * Returns the ids of the inserted rows so a caller can undo exactly this batch.
 */
export async function logManyEpisodeWatches(
  episodes: { id: string; title_id: string }[],
): Promise<string[]> {
  if (episodes.length === 0) return [];
  const uid = await requireViewer();
  const rows = episodes.map((e) => ({
    user_id: uid,
    episode_id: e.id,
    title_id: e.title_id,
  }));
  const { data, error } = await supabase
    .from('episode_watches')
    .insert(rows)
    .select('id');
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

// --- movies -------------------------------------------------------------

export type MovieWatch = { id: string; watched_at: string };

/** Log a (re)watch of a movie — a dated diary entry. Returns the inserted row id. */
export async function logMovieWatch(titleId: string): Promise<string> {
  const uid = await requireViewer();
  const { data, error } = await supabase
    .from('movie_watches')
    .insert({ user_id: uid, title_id: titleId })
    .select('id')
    .single();
  if (error) throw error;
  // Logging a movie watch means you've seen it: promote the library entry to
  // Completed, creating it if this title wasn't tracked yet. Upsert overwrites
  // any earlier status (watchlist, on hold, …) since a watch is proof it's done.
  await setLibraryStatus(titleId, 'completed');
  return data.id as string;
}

export async function getMovieWatches(titleId: string): Promise<MovieWatch[]> {
  const { q } = await selectMine('movie_watches', 'id, watched_at');
  const { data, error } = await q
    .eq('title_id', titleId)
    .order('watched_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MovieWatch[];
}

export async function removeMovieWatch(watchId: string) {
  // Scoped by RLS: the owner-only write policy lets a user delete only their own row.
  const { error } = await supabase
    .from('movie_watches')
    .delete()
    .eq('id', watchId);
  if (error) throw error;
}

// --- diary (combined chronological history) -----------------------------

export type DiaryEntry = {
  id: string;
  kind: 'movie' | 'episode';
  watched_at: string;
  titleName: string;
  posterPath: string | null;
  subtitle: string | null;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  /** Underlying watch rows (1 for movies, N for grouped episode entries). */
  rows: { id: string; watched_at: string }[];
};

export type DiaryRange = {
  /** Inclusive lower bound (ISO). */
  from?: string;
  /** Exclusive upper bound (ISO). */
  to?: string;
  /** Row cap; pass null for no cap (used for bounded periods). */
  limit?: number | null;
  /** Whose diary to read; defaults to the signed-in user. */
  userId?: string;
};

/** Combined movie + episode watch history, newest first. */
export async function getDiary({
  from,
  to,
  limit = 100,
  userId,
}: DiaryRange = {}): Promise<DiaryEntry[]> {
  // May read another user's (public) diary, so scope to the explicit id when
  // given, otherwise to the viewer.
  const uid = userId ?? (await currentViewer());
  if (!uid) throw new Error('Not signed in');

  const build = (table: 'movie_watches' | 'episode_watches', select: string) => {
    let q = supabase
      .from(table)
      .select(select)
      .eq('user_id', uid)
      .order('watched_at', { ascending: false });
    if (from) q = q.gte('watched_at', from);
    if (to) q = q.lt('watched_at', to);
    if (limit != null) q = q.limit(limit);
    return q;
  };

  const [movies, episodes] = await Promise.all([
    build(
      'movie_watches',
      'id, watched_at, title:titles(title, poster_path, tmdb_id, media_type)',
    ),
    build(
      'episode_watches',
      'id, watched_at, episode:episodes(name, season_number, episode_number), title:titles(title, poster_path, tmdb_id, media_type)',
    ),
  ]);
  if (movies.error) throw movies.error;
  if (episodes.error) throw episodes.error;

  const movieEntries: DiaryEntry[] = (movies.data ?? []).map((r: any) => ({
    id: `m_${r.id}`,
    kind: 'movie',
    watched_at: r.watched_at,
    titleName: r.title?.title ?? 'Unknown',
    posterPath: r.title?.poster_path ?? null,
    subtitle: 'Movie',
    tmdbId: r.title?.tmdb_id,
    mediaType: r.title?.media_type ?? 'movie',
    rows: [{ id: r.id, watched_at: r.watched_at }],
  }));

  // Group episode watches by show + season + calendar day, so logging a whole
  // season collapses to one diary entry ("Season 8 · 6 episodes") instead of a
  // wall of identical rows.
  const episodeGroups = new Map<string, any[]>();
  for (const r of (episodes.data ?? []) as any[]) {
    const day = (r.watched_at as string).slice(0, 10);
    const season = r.episode?.season_number ?? 'na';
    const key = `${r.title?.tmdb_id}_${season}_${day}`;
    const bucket = episodeGroups.get(key);
    if (bucket) bucket.push(r);
    else episodeGroups.set(key, [r]);
  }

  const episodeEntries: DiaryEntry[] = [...episodeGroups.values()].map((group) => {
    group.sort((a: any, b: any) => b.watched_at.localeCompare(a.watched_at));
    const r = group[0]; // most recent in the group
    const ep = r.episode;
    const count = group.length;
    const subtitle =
      count > 1
        ? ep
          ? `Season ${ep.season_number} · ${count} episodes`
          : `${count} episodes`
        : ep
          ? `S${ep.season_number}E${ep.episode_number}` +
            (ep.name ? ` · ${ep.name}` : '')
          : null;
    return {
      id: `e_${r.id}`,
      kind: 'episode',
      watched_at: r.watched_at,
      titleName: r.title?.title ?? 'Unknown',
      posterPath: r.title?.poster_path ?? null,
      subtitle,
      tmdbId: r.title?.tmdb_id,
      mediaType: r.title?.media_type ?? 'tv',
      rows: group.map((g: any) => ({ id: g.id, watched_at: g.watched_at })),
    };
  });

  return [...movieEntries, ...episodeEntries]
    .sort((a, b) => b.watched_at.localeCompare(a.watched_at))
    .slice(0, limit ?? undefined);
}

/**
 * Move watch rows to a new calendar day, preserving each row's time-of-day so
 * within-day ordering survives. RLS scopes the updates to the owner's rows.
 */
export async function updateWatchDay(
  kind: 'movie' | 'episode',
  rows: { id: string; watched_at: string }[],
  day: Date,
) {
  const table = kind === 'movie' ? 'movie_watches' : 'episode_watches';
  await Promise.all(
    rows.map((r) => {
      const old = new Date(r.watched_at);
      const next = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        old.getHours(),
        old.getMinutes(),
        old.getSeconds(),
        old.getMilliseconds(),
      );
      return supabase
        .from(table)
        .update({ watched_at: next.toISOString() })
        .eq('id', r.id)
        .then(({ error }) => {
          if (error) throw error;
        });
    }),
  );
}
