import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { keys } from '@/lib/keys';
import {
  getLibraryStatus,
  removeFromLibrary,
  setLibraryStatus,
  type LibraryStatus,
} from '@/lib/library';
import { fetchAllEpisodes, getTitle, type SearchResult } from '@/lib/tmdb';
import { useSessionLog } from '@/lib/use-session-log';
import {
  airedOnly,
  logManyEpisodeWatches,
  logMovieWatch,
  removeEpisodeWatchesByIds,
  removeMovieWatch,
} from '@/lib/watches';

/**
 * What one swipe-logged Search row wrote: exactly the rows it inserted, so undo
 * reverses them precisely — and, for movies, the pre-log Library status so undo
 * can restore it (logMovieWatch forces Completed).
 */
type LoggedRows = {
  kind: 'movie' | 'tv';
  titleId: string;
  watchIds: string[];
  priorStatus: LibraryStatus | null;
};

/** Identity of a search result in the session-log map, and as a list key. */
export const itemKey = (r: SearchResult) => `${r.media_type}-${r.tmdb_id}`;

/**
 * Search's swipe-to-log: a movie logs one watch, a series every aired
 * non-Specials episode. Session-scoped and optimistic (`useSessionLog`).
 * See ADR 0011.
 */
export function useSearchLog() {
  const queryClient = useQueryClient();

  const invalidateWatchData = useCallback(
    (titleId?: string) => {
      queryClient.invalidateQueries({ queryKey: keys.diary() });
      queryClient.invalidateQueries({ queryKey: keys.stats() });
      if (titleId) {
        // A movie log/undo also moves its Library status → refresh those views.
        queryClient.invalidateQueries({ queryKey: keys.library() });
        queryClient.invalidateQueries({ queryKey: keys.libraryStatus(titleId) });
      }
    },
    [queryClient],
  );

  /** Delete exactly the rows an entry inserted (+ restore a movie's status). */
  const { logged, log, undo } = useSessionLog<LoggedRows>(async (rows) => {
    if (rows.kind === 'movie') {
      await removeMovieWatch(rows.watchIds[0]);
      if (rows.priorStatus) await setLibraryStatus(rows.titleId, rows.priorStatus);
      else await removeFromLibrary(rows.titleId);
      invalidateWatchData(rows.titleId);
    } else {
      await removeEpisodeWatchesByIds(rows.watchIds);
      invalidateWatchData();
    }
  });

  const logItem = useCallback(
    (item: SearchResult) =>
      log(itemKey(item), async () => {
        // Same read-through the row already prefetches onPressIn → usually warm.
        const { title, seasons } = await getTitle(item.tmdb_id, item.media_type);
        if (item.media_type === 'tv') {
          const seasonNumbers = seasons
            .map((s) => s.season_number)
            .filter((n) => n >= 1) // exclude Specials (season 0)
            .sort((a, b) => a - b);
          const episodes = airedOnly(
            await fetchAllEpisodes(item.tmdb_id, seasonNumbers),
          );
          // Nothing aired yet → nothing to log; throwing rolls the ✓ back.
          if (episodes.length === 0) throw new Error('no aired episodes');
          const ids = await logManyEpisodeWatches(
            episodes.map((e) => ({ id: e.id, title_id: e.title_id })),
          );
          invalidateWatchData();
          return { kind: 'tv', titleId: title.id, watchIds: ids, priorStatus: null };
        }
        const priorStatus = await getLibraryStatus(title.id);
        const watchId = await logMovieWatch(title.id);
        invalidateWatchData(title.id);
        return { kind: 'movie', titleId: title.id, watchIds: [watchId], priorStatus };
      }),
    [log, invalidateWatchData],
  );

  const undoItem = useCallback((item: SearchResult) => undo(itemKey(item)), [undo]);

  return { logged, logItem, undoItem };
}
