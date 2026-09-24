// Historical watch rows for the importers, through the viewer seam.
//
// The loggers in src/lib/watches.ts stamp watched_at = now(), so imports have
// their own inserts. Idempotency is entirely prefetch-based:
// episode_watches/movie_watches have no unique constraints, so an importer
// must prefetch fresh state at the start of every run and never let two runs
// overlap.

import { supabase } from '@/lib/supabase';
import { requireViewer, selectAllMine } from '@/lib/viewer';

const INSERT_CHUNK = 500;

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
