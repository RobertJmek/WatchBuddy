// Viewer-seam writes for the WatchBuddy importer.
//
// The watch inserts + first-watch / movie dedupe prefetch are identical to the
// TV Time importer, so we reuse them wholesale from ../tvtime/db. The one thing
// TV Time doesn't need is per-event rewatch dedupe (its rewatches are collapsed
// to a count), so that prefetch lives here.

import { selectMine } from '@/lib/viewer';

export {
  insertEpisodeWatches,
  insertMovieWatch,
  movieAtKey,
  prefetchEpisodeWatchState,
  prefetchMovieWatchState,
} from '@/lib/tvtime/db';
export type {
  EpisodeWatchState,
  MovieWatchState,
  WatchInsert,
} from '@/lib/tvtime/db';

const PAGE = 1000;

/** `${episode_id}|${watched_at ISO, second precision}` — one rewatch event. */
export function episodeRewatchAtKey(episodeId: string, watchedAtIso: string): string {
  return `${episodeId}|${watchedAtIso.slice(0, 19)}`;
}

/**
 * Dedupe keys for the viewer's existing episode *rewatch* rows. Lets a re-import
 * skip a rewatch event it already inserted while preserving each event's own
 * timestamp (unlike TV Time, whose rewatches are count-based).
 */
export async function prefetchEpisodeRewatchAtKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let page = 0; ; page++) {
    const { q } = await selectMine('episode_watches', 'episode_id, watched_at, is_rewatch');
    const { data, error } = await q
      .eq('is_rewatch', true)
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { episode_id: string; watched_at: string }[];
    for (const r of rows) keys.add(episodeRewatchAtKey(r.episode_id, r.watched_at));
    if (rows.length < PAGE) break;
  }
  return keys;
}
