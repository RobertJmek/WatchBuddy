import {
  groupDiary,
  mergeDiaryPage,
  type DiaryCursor,
  type DiaryEntry,
  type DiaryPage,
  type DiaryWatch,
} from '@/lib/diary-page';
import {
  getLibraryStatus,
  removeFromLibrary,
  setLibraryStatus,
  type LibraryStatus,
} from '@/lib/library';
import { supabase } from '@/lib/supabase';
import { fetchAllEpisodes, getTitle } from '@/lib/tmdb';
import {
  currentViewer,
  deleteMine,
  requireViewer,
  selectMine,
  updateMine,
} from '@/lib/viewer';

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

/** Delete specific episode-watch rows by id. Used by the Search swipe-to-log
 *  undo to reverse *exactly* the rows a swipe inserted. */
export async function removeEpisodeWatchesByIds(ids: string[]) {
  if (ids.length === 0) return;
  const { q } = await deleteMine('episode_watches');
  const { error } = await q.in('id', ids);
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
  const { q: del } = await deleteMine('episode_watches');
  const { error: delErr } = await del.eq('id', row.id);
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
  const { q } = await deleteMine('movie_watches');
  const { error } = await q.eq('id', watchId);
  if (error) throw error;
}

// --- implied watches ------------------------------------------------------

/**
 * What an implied watch wrote, so the caller can undo exactly that. For a movie
 * `priorStatus` is the Library status before the log, since `logMovieWatch`
 * forces Completed.
 */
export type ImpliedWatch =
  | { kind: 'movie'; titleId: string; watchIds: string[]; priorStatus: LibraryStatus | null }
  | { kind: 'tv'; titleId: string; watchIds: string[] };

/** Today as `YYYY-MM-DD` in local time — the shape TMDB's `air_date` uses. */
function localToday() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Aired = has an air date on or before today (local). An unknown date counts
 * as not aired. Every *bulk* log (whole series, whole season, the Search swipe,
 * an implied watch) keeps only aired episodes; a single-episode `+` doesn't ask.
 */
function isAired(e: { air_date: string | null }): boolean {
  return e.air_date != null && e.air_date <= localToday();
}

export function airedOnly<T extends { air_date: string | null }>(eps: T[]): T[] {
  return eps.filter(isAired);
}

/**
 * Make sure a title counts as watched, without ever logging a second time.
 * Called when the viewer rates a title or marks it Completed (ADR 0024).
 *
 * - Movie: logs one watch only if there is none yet.
 * - Series: logs every *aired* episode (Specials excluded) that has no watch.
 *   With `onlyIfUntouched` — the rating path — it does nothing as soon as any
 *   episode has been watched: rating a show you're halfway through is an
 *   opinion, not a claim you've finished it.
 *
 * Deliberately not called from `setRating` / `setLibraryStatus`: the importers
 * and the Search undo write those too, and must not log anything.
 *
 * Returns null when nothing was written.
 */
export async function ensureWatched(
  title: { id: string; tmdbId: number; mediaType: 'movie' | 'tv' },
  opts: { onlyIfUntouched: boolean },
): Promise<ImpliedWatch | null> {
  if (title.mediaType === 'movie') {
    if ((await getMovieWatches(title.id)).length > 0) return null;
    const priorStatus = await getLibraryStatus(title.id);
    const watchId = await logMovieWatch(title.id);
    return { kind: 'movie', titleId: title.id, watchIds: [watchId], priorStatus };
  }

  const counts = await getEpisodeWatchCounts(title.id);
  if (opts.onlyIfUntouched && counts.size > 0) return null;
  const { seasons } = await getTitle(title.tmdbId, 'tv');
  const seasonNumbers = seasons
    .map((s) => s.season_number)
    .filter((n) => n >= 1) // exclude Specials (season 0)
    .sort((a, b) => a - b);
  const episodes = airedOnly(
    await fetchAllEpisodes(title.tmdbId, seasonNumbers),
  ).filter((e) => !counts.has(e.id));
  if (episodes.length === 0) return null;
  const watchIds = await logManyEpisodeWatches(
    episodes.map((e) => ({ id: e.id, title_id: e.title_id })),
  );
  return { kind: 'tv', titleId: title.id, watchIds };
}

/** Reverse exactly what `ensureWatched` wrote (+ restore a movie's status). */
export async function undoImpliedWatch(w: ImpliedWatch) {
  if (w.kind === 'movie') {
    await removeMovieWatch(w.watchIds[0]);
    if (w.priorStatus) await setLibraryStatus(w.titleId, w.priorStatus);
    else await removeFromLibrary(w.titleId);
  } else {
    await removeEpisodeWatchesByIds(w.watchIds);
  }
}

// --- diary (combined chronological history) -----------------------------

export type DiaryRange = {
  /** Inclusive lower bound (ISO). */
  from?: string;
  /** Exclusive upper bound (ISO). */
  to?: string;
  /** Only watches of titles whose name contains this. */
  search?: string;
  /** Whose diary to read; defaults to the signed-in user. */
  userId?: string;
};

/**
 * One page of watch history, newest first, from both tables. Rows stay raw so
 * the caller groups every loaded page at once: a season logged across a page
 * boundary is still one entry. PostgREST caps a read at 1000 rows, so the
 * whole history is only reachable by paging.
 */
export async function getDiaryPage(
  { from, to, search, userId }: DiaryRange,
  cursor: DiaryCursor | null = null,
  size = 100,
): Promise<DiaryPage> {
  // May read another user's (public) diary, so scope to the explicit id when
  // given, otherwise to the viewer.
  const uid = userId ?? (await currentViewer());
  if (!uid) throw new Error('Not signed in');

  // LIKE wildcards in the term are literal; `!inner` makes the embedded
  // filter drop the watch row rather than just null its title.
  const term = search?.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const title = `title:titles${term ? '!inner' : ''}(title, poster_path, tmdb_id, media_type)`;

  const build = (table: 'movie_watches' | 'episode_watches', embeds: string) => {
    let q = supabase
      .from(table)
      .select(`id, watched_at, ${embeds}`)
      .eq('user_id', uid)
      .order('watched_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(size);
    if (from) q = q.gte('watched_at', from);
    if (to) q = q.lt('watched_at', to);
    if (term) q = q.ilike('title.title', `%${term}%`);
    if (cursor) {
      const at = `"${cursor.watched_at}"`;
      q = q.or(`watched_at.lt.${at},and(watched_at.eq.${at},id.lt.${cursor.id})`);
    }
    return q;
  };

  const [movies, episodes] = await Promise.all([
    build('movie_watches', title),
    build('episode_watches', `episode:episodes(name, season_number, episode_number), ${title}`),
  ]);
  if (movies.error) throw movies.error;
  if (episodes.error) throw episodes.error;

  const tag = (kind: DiaryWatch['kind'], rows: unknown[] | null) =>
    ((rows ?? []) as Omit<DiaryWatch, 'kind'>[]).map((r) => ({ ...r, kind }));
  return mergeDiaryPage(tag('movie', movies.data), tag('episode', episodes.data), size);
}

/** The most recent `limit` diary entries of a user (a profile's preview). */
export async function getDiary({
  userId,
  limit,
}: {
  userId?: string;
  limit: number;
}): Promise<DiaryEntry[]> {
  const page = await getDiaryPage({ userId }, null, limit);
  return groupDiary(page.rows).slice(0, limit);
}

/**
 * Move watch rows to a new calendar day, preserving each row's time-of-day so
 * within-day ordering survives — but never past now: moving a 23:00 watch to
 * today in the morning would otherwise date it in the future. Each update is
 * scoped to the viewer by `updateMine`; RLS is the backstop, not the mechanism.
 */
export async function updateWatchDay(
  kind: 'movie' | 'episode',
  rows: { id: string; watched_at: string }[],
  day: Date,
) {
  const table = kind === 'movie' ? 'movie_watches' : 'episode_watches';
  const now = Date.now();
  await Promise.all(
    rows.map(async (r) => {
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
      const { q } = await updateMine(table, {
        watched_at: new Date(Math.min(next.getTime(), now)).toISOString(),
      });
      const { error } = await q.eq('id', r.id);
      if (error) throw error;
    }),
  );
}
