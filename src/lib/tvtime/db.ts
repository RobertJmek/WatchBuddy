// Personal writes for the TV Time importer, through the viewer seam.
//
// The existing loggers in src/lib/watches.ts stamp watched_at = now() (and
// logMovieWatch force-promotes the library status), so the importer has its
// own helpers: historical timestamps, and "existing library rows win".
//
// Idempotency is entirely prefetch-based — episode_watches/movie_watches have
// no unique constraints, so the engine must prefetch fresh state at the start
// of every run and never let two runs overlap.

import { supabase } from '@/lib/supabase';
import type { LibraryStatus } from '@/lib/library';
import { requireViewer, selectMine } from '@/lib/viewer';

const PAGE = 1000;
const INSERT_CHUNK = 500;

/** TV Time's "YYYY-MM-DD HH:MM:SS" (UTC) → ISO timestamp for Postgres. */
export function toIsoTimestamp(tvTime: string): string {
  const d = new Date(tvTime.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function selectAllMine<T>(table: string, columns: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; ; page++) {
    const { q } = await selectMine(table, columns);
    const { data, error } = await q.range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return all;
}

export type EpisodeWatchState = {
  /** Episode ids that already have a first-watch row. */
  existingFirst: Set<string>;
  /** Episode id → number of rewatch rows already present. */
  existingRewatch: Map<string, number>;
};

export async function prefetchEpisodeWatchState(): Promise<EpisodeWatchState> {
  const rows = await selectAllMine<{ episode_id: string; is_rewatch: boolean }>(
    'episode_watches',
    'episode_id, is_rewatch',
  );
  const existingFirst = new Set<string>();
  const existingRewatch = new Map<string, number>();
  for (const r of rows) {
    if (r.is_rewatch) {
      existingRewatch.set(r.episode_id, (existingRewatch.get(r.episode_id) ?? 0) + 1);
    } else {
      existingFirst.add(r.episode_id);
    }
  }
  return { existingFirst, existingRewatch };
}

export type MovieWatchState = {
  /** Title id → number of watch rows already present. */
  countByTitle: Map<string, number>;
  /** `${title_id}|${watched_at ISO, second precision}` dedupe keys. */
  atKeys: Set<string>;
};

export function movieAtKey(titleId: string, watchedAtIso: string): string {
  return `${titleId}|${watchedAtIso.slice(0, 19)}`;
}

export async function prefetchMovieWatchState(): Promise<MovieWatchState> {
  const rows = await selectAllMine<{ title_id: string; watched_at: string }>(
    'movie_watches',
    'title_id, watched_at',
  );
  const countByTitle = new Map<string, number>();
  const atKeys = new Set<string>();
  for (const r of rows) {
    countByTitle.set(r.title_id, (countByTitle.get(r.title_id) ?? 0) + 1);
    atKeys.add(movieAtKey(r.title_id, r.watched_at));
  }
  return { countByTitle, atKeys };
}

export type LibraryState = Map<string, { status: LibraryStatus; is_favorite: boolean }>;

export async function prefetchLibrary(): Promise<LibraryState> {
  const rows = await selectAllMine<{
    title_id: string;
    status: LibraryStatus;
    is_favorite: boolean;
  }>('library_items', 'title_id, status, is_favorite');
  return new Map(rows.map((r) => [r.title_id, r]));
}

export type WatchInsert = {
  episode_id: string;
  title_id: string;
  watched_at: string;
  is_rewatch: boolean;
};

export async function insertEpisodeWatches(rows: WatchInsert[]): Promise<void> {
  if (!rows.length) return;
  const uid = await requireViewer();
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK).map((r) => ({ ...r, user_id: uid }));
    const { error } = await supabase.from('episode_watches').insert(chunk);
    if (error) throw error;
  }
}

export async function insertMovieWatch(row: {
  title_id: string;
  watched_at: string;
  is_rewatch: boolean;
}): Promise<void> {
  const uid = await requireViewer();
  const { error } = await supabase
    .from('movie_watches')
    .insert({ ...row, user_id: uid });
  if (error) throw error;
}

/**
 * Insert a library row with the inferred status — but never touch an existing
 * one. `state` is the prefetched library map; it's updated in place so later
 * phases see the row.
 */
export async function setLibraryStatusIfAbsent(
  state: LibraryState,
  titleId: string,
  status: LibraryStatus,
): Promise<void> {
  if (state.has(titleId)) return;
  const uid = await requireViewer();
  const { error } = await supabase.from('library_items').upsert(
    { user_id: uid, title_id: titleId, status },
    { onConflict: 'user_id,title_id', ignoreDuplicates: true },
  );
  if (error) throw error;
  state.set(titleId, { status, is_favorite: false });
}
