import { supabase } from '@/lib/supabase';

/** How many times the user has watched each episode of a title. */
export async function getEpisodeWatchCounts(
  titleId: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('episode_watches')
    .select('episode_id')
    .eq('title_id', titleId);
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('episode_watches').insert({
    user_id: user.id,
    episode_id: episodeId,
    title_id: titleId,
  });
  if (error) throw error;
}

/** Remove the user's most recent single watch of an episode. */
export async function removeOneEpisodeWatch(episodeId: string) {
  const { data, error } = await supabase
    .from('episode_watches')
    .select('id')
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

/** Log one watch for every episode given (a whole-season or whole-series watch). */
export async function logManyEpisodeWatches(
  episodes: { id: string; title_id: string }[],
) {
  if (episodes.length === 0) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const rows = episodes.map((e) => ({
    user_id: user.id,
    episode_id: e.id,
    title_id: e.title_id,
  }));
  const { error } = await supabase.from('episode_watches').insert(rows);
  if (error) throw error;
}

// --- movies -------------------------------------------------------------

export type MovieWatch = { id: string; watched_at: string };

/** Log a (re)watch of a movie — a dated diary entry. */
export async function logMovieWatch(titleId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('movie_watches')
    .insert({ user_id: user.id, title_id: titleId });
  if (error) throw error;
}

export async function getMovieWatches(titleId: string): Promise<MovieWatch[]> {
  const { data, error } = await supabase
    .from('movie_watches')
    .select('id, watched_at')
    .eq('title_id', titleId)
    .order('watched_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MovieWatch[];
}

export async function removeMovieWatch(watchId: string) {
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
};

/** Combined movie + episode watch history, newest first. */
export async function getDiary(limit = 100): Promise<DiaryEntry[]> {
  const [movies, episodes] = await Promise.all([
    supabase
      .from('movie_watches')
      .select('id, watched_at, title:titles(title, poster_path, tmdb_id, media_type)')
      .order('watched_at', { ascending: false })
      .limit(limit),
    supabase
      .from('episode_watches')
      .select(
        'id, watched_at, episode:episodes(name, season_number, episode_number), title:titles(title, poster_path, tmdb_id, media_type)',
      )
      .order('watched_at', { ascending: false })
      .limit(limit),
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
  }));

  const episodeEntries: DiaryEntry[] = (episodes.data ?? []).map((r: any) => ({
    id: `e_${r.id}`,
    kind: 'episode',
    watched_at: r.watched_at,
    titleName: r.title?.title ?? 'Unknown',
    posterPath: r.title?.poster_path ?? null,
    subtitle: r.episode
      ? `S${r.episode.season_number}E${r.episode.episode_number}` +
        (r.episode.name ? ` · ${r.episode.name}` : '')
      : null,
    tmdbId: r.title?.tmdb_id,
    mediaType: r.title?.media_type ?? 'tv',
  }));

  return [...movieEntries, ...episodeEntries]
    .sort((a, b) => b.watched_at.localeCompare(a.watched_at))
    .slice(0, limit);
}
