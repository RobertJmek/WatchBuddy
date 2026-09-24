import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { hapticFailure, hapticSuccess, hapticUndo } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import {
  getLibraryStatus,
  removeFromLibrary,
  setLibraryStatus,
  type LibraryStatus,
} from '@/lib/library';
import { fetchAllEpisodes, getTitle, type SearchResult } from '@/lib/tmdb';
import {
  airedOnly,
  logManyEpisodeWatches,
  logMovieWatch,
  removeEpisodeWatchesByIds,
  removeMovieWatch,
} from '@/lib/watches';

/**
 * One swipe-logged Search row, remembered for the session. Holds exactly the
 * rows the swipe inserted so undo reverses them precisely — and, for movies, the
 * pre-log Library status so undo can restore it (logMovieWatch forces Completed).
 */
type LoggedEntry = {
  kind: 'movie' | 'tv';
  titleId: string;
  watchIds: string[];
  priorStatus: LibraryStatus | null;
  /** True while the optimistic ✓ is shown but the DB write hasn't landed yet. */
  pending: boolean;
};

/** Identity of a search result in the session-log map, and as a list key. */
export const itemKey = (r: SearchResult) => `${r.media_type}-${r.tmdb_id}`;

/**
 * Search's swipe-to-log: session-scoped and optimistic. A swipe shows the ✓ at
 * once and writes in the background; an undo reverses exactly the rows that
 * swipe inserted, even while the write is still in flight. See ADR 0011.
 */
export function useSearchLog() {
  const queryClient = useQueryClient();
  const [logged, setLogged] = useState<Map<string, LoggedEntry>>(new Map());
  // Cancel tokens for in-flight logs, so an undo tapped *before* the DB write
  // finishes can cancel it — the write, once done, rolls itself back.
  const inflight = useRef(new Map<string, { cancelled: boolean }>());
  // The two handlers below are handed to memoized rows, so they have to stay
  // referentially stable — which means they can't close over `logged`. They read
  // it through here instead. (Same mailbox pattern as `range-slider`.)
  const loggedRef = useRef(logged);
  // eslint-disable-next-line react-hooks/refs -- a mailbox, not render state
  loggedRef.current = logged;

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
  const reverseEntry = useCallback(async function reverseEntry(entry: LoggedEntry) {
    if (entry.kind === 'movie') {
      await removeMovieWatch(entry.watchIds[0]);
      if (entry.priorStatus)
        await setLibraryStatus(entry.titleId, entry.priorStatus);
      else await removeFromLibrary(entry.titleId);
      invalidateWatchData(entry.titleId);
    } else {
      await removeEpisodeWatchesByIds(entry.watchIds);
      invalidateWatchData();
    }
  }, [invalidateWatchData]);

  const logItem = useCallback(function logItem(item: SearchResult) {
    const key = itemKey(item);
    if (loggedRef.current.has(key)) return;
    const kind: LoggedEntry['kind'] = item.media_type === 'tv' ? 'tv' : 'movie';
    // Optimistic: show the ✓ instantly; the DB write runs in the background.
    setLogged((prev) =>
      new Map(prev).set(key, {
        kind,
        titleId: '',
        watchIds: [],
        priorStatus: null,
        pending: true,
      }),
    );
    hapticSuccess();
    const token = { cancelled: false };
    inflight.current.set(key, token);
    void (async () => {
      try {
        // Same read-through the row already prefetches onPressIn → usually warm.
        const { title, seasons } = await getTitle(item.tmdb_id, item.media_type);
        let entry: LoggedEntry;
        if (item.media_type === 'tv') {
          const seasonNumbers = seasons
            .map((s) => s.season_number)
            .filter((n) => n >= 1) // exclude Specials (season 0)
            .sort((a, b) => a - b);
          const episodes = airedOnly(
            await fetchAllEpisodes(item.tmdb_id, seasonNumbers),
          );
          // Nothing aired yet → nothing to log; the catch rolls the ✓ back.
          if (episodes.length === 0) throw new Error('no aired episodes');
          const ids = await logManyEpisodeWatches(
            episodes.map((e) => ({ id: e.id, title_id: e.title_id })),
          );
          entry = {
            kind: 'tv',
            titleId: title.id,
            watchIds: ids,
            priorStatus: null,
            pending: false,
          };
        } else {
          const priorStatus = await getLibraryStatus(title.id);
          const watchId = await logMovieWatch(title.id);
          entry = {
            kind: 'movie',
            titleId: title.id,
            watchIds: [watchId],
            priorStatus,
            pending: false,
          };
        }
        inflight.current.delete(key);
        if (token.cancelled) {
          // Undone while the write was in flight → roll it straight back.
          await reverseEntry(entry);
          return;
        }
        // Swap the pending entry for the resolved one (with real ids for undo).
        setLogged((prev) => (prev.has(key) ? new Map(prev).set(key, entry) : prev));
        invalidateWatchData(entry.kind === 'movie' ? entry.titleId : undefined);
      } catch {
        inflight.current.delete(key);
        // Roll the optimistic ✓ back on failure.
        setLogged((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        hapticFailure();
      }
    })();
  }, [invalidateWatchData, reverseEntry]);

  const undoItem = useCallback(function undoItem(item: SearchResult) {
    const key = itemKey(item);
    const entry = loggedRef.current.get(key);
    if (!entry) return;
    // Optimistic: drop the ✓ instantly.
    setLogged((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    hapticUndo();
    const token = inflight.current.get(key);
    if (token) {
      // Still writing — cancel; the log's completion handler rolls it back.
      token.cancelled = true;
      return;
    }
    // Resolved entry → delete its rows now.
    void reverseEntry(entry).catch(() => {});
  }, [reverseEntry]);

  return { logged, logItem, undoItem };
}
