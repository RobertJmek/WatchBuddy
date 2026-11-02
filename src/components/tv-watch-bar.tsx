import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { WatchButton, WatchSummary } from '@/components/movie-watch-bar';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { hapticFailure, hapticSuccess, hapticUndo } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import { setLibraryStatus } from '@/lib/library';
import { fetchAllEpisodes, type SeasonRow } from '@/lib/tmdb';
import {
  airedOnly,
  getEpisodeWatchCounts,
  getLastEpisodeWatchAt,
  logManyEpisodeWatches,
  seriesPasses,
  undoSeriesPass,
} from '@/lib/watches';

/**
 * "Log whole series": +1 watch on every aired episode, every press, so on a
 * series you've seen it is a rewatch and the counts go up (the same rule as
 * "Log whole season" and the season swipe). Then marks the series Completed,
 * as logging a movie does.
 *
 * Under it, the same "Watched N× · last <date> · Undo last" line as a movie.
 * N is read from the database — complete passes, the lowest watch count among
 * the aired episodes — so it shows for logs from earlier versions, other
 * visits and other devices too. Undo takes one pass off (the latest watch of
 * every aired episode); a series left with no complete pass goes back to
 * Watching, or to Watchlist when nothing at all is left watched.
 *
 * Both are optimistic: a whole series takes seconds to write, so N changes on
 * the tap and a failed write puts it back.
 */
type Passes = { airedIds: string[]; passes: number; lastAt: string | null };

export function TvWatchBar({
  titleId,
  tmdbId,
  seasons,
}: {
  titleId: string;
  tmdbId: number;
  seasons: SeasonRow[];
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A full-series watch excludes "Specials" (season 0).
  const seasonNumbers = seasons
    .map((s) => s.season_number)
    .filter((n) => n >= 1)
    .sort((a, b) => a - b);

  const key = keys.seriesPasses(titleId);
  const passesQ = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Passes> => {
      const [all, counts, lastAt] = await Promise.all([
        fetchAllEpisodes(tmdbId, seasonNumbers),
        getEpisodeWatchCounts(titleId),
        getLastEpisodeWatchAt(titleId),
      ]);
      const airedIds = airedOnly(all).map((e) => e.id);
      return { airedIds, passes: seriesPasses(airedIds, counts), lastAt };
    },
    enabled: seasonNumbers.length > 0,
  });

  // The season screen's +/− don't know this key; catch up on coming back.
  const { refetch } = passesQ;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: keys.diary() });
    queryClient.invalidateQueries({ queryKey: keys.stats() });
    queryClient.invalidateQueries({ queryKey: keys.library() });
    queryClient.invalidateQueries({ queryKey: keys.libraryStatus(titleId) });
  };

  async function logSeries() {
    if (busy || seasonNumbers.length === 0) return;
    setBusy(true);
    setMessage(null);
    await queryClient.cancelQueries({ queryKey: key });
    const prev = queryClient.getQueryData<Passes>(key);
    try {
      // The query already holds the aired episodes; fetch only on a cold cache.
      const airedIds =
        prev?.airedIds ??
        airedOnly(await fetchAllEpisodes(tmdbId, seasonNumbers)).map((e) => e.id);
      if (airedIds.length === 0) {
        setMessage('No aired episodes yet');
        hapticFailure();
        return;
      }
      hapticSuccess();
      queryClient.setQueryData<Passes>(key, {
        airedIds,
        passes: (prev?.passes ?? 0) + 1,
        lastAt: new Date().toISOString(),
      });
      await logManyEpisodeWatches(airedIds.map((id) => ({ id, title_id: titleId })));
      await setLibraryStatus(titleId, 'completed');
    } catch {
      queryClient.setQueryData(key, prev);
      setMessage("Couldn't log the episodes. Try again.");
      hapticFailure();
    } finally {
      setBusy(false);
      invalidate();
    }
  }

  async function undoPass() {
    const current = passesQ.data;
    if (busy || !current || current.passes === 0) return;
    setBusy(true);
    setMessage(null);
    hapticUndo();
    await queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData<Passes>(key, { ...current, passes: current.passes - 1 });
    try {
      const left = await undoSeriesPass(titleId, current.airedIds);
      if (current.passes === 1) {
        await setLibraryStatus(titleId, left > 0 ? 'watching' : 'watchlist');
      }
    } catch {
      queryClient.setQueryData(key, current);
      setMessage("Couldn't undo. Try again.");
      hapticFailure();
    } finally {
      setBusy(false);
      invalidate();
    }
  }

  return (
    <View style={styles.container}>
      <WatchButton label="Log whole series" busy={busy} onPress={logSeries} />
      <WatchSummary
        count={passesQ.data?.passes ?? 0}
        lastAt={passesQ.data?.lastAt ?? null}
        busy={busy}
        onUndo={undoPass}
        undoLabel="Undo one series watch"
      />
      {message && <ThemedText type="small">{message}</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
});
