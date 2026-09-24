// The one prefetch the WatchBuddy importer needs beyond ../import-core:
// per-event rewatch dedupe. TV Time collapses rewatches to a count, so it
// never needs this; an export keeps each rewatch's own timestamp.

import { selectAllMine } from '@/lib/viewer';

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
  const rows = await selectAllMine<{ episode_id: string; watched_at: string }>(
    'episode_watches',
    'episode_id, watched_at, is_rewatch',
    (q) => q.eq('is_rewatch', true),
  );
  return new Set(rows.map((r) => episodeRewatchAtKey(r.episode_id, r.watched_at)));
}
