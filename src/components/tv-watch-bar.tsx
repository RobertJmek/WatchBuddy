import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { hapticFailure, hapticSuccess, hapticUndo } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import { setLibraryStatus } from '@/lib/library';
import { fetchAllEpisodes, type SeasonRow } from '@/lib/tmdb';
import {
  airedOnly,
  getEpisodeWatchCounts,
  logManyEpisodeWatches,
  seriesPasses,
  undoSeriesPass,
} from '@/lib/watches';

const ACTIVE = Accent;

/**
 * "Log whole series": +1 watch on every aired episode, every press, so on a
 * series you've seen it is a rewatch and the counts go up (the same rule as
 * "Log whole season" and the season swipe). Then marks the series Completed,
 * as logging a movie does.
 *
 * Under it, "Logged N times · Undo". N is read from the database — complete
 * passes, the lowest watch count among the aired episodes — so it shows for
 * logs from earlier versions, other visits and other devices too. Undo takes
 * one pass off (the latest watch of every aired episode); a series left with
 * no complete pass but some watches goes back to Watching.
 */
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

  const passesQ = useQuery({
    queryKey: keys.seriesPasses(titleId),
    queryFn: async () => {
      const [all, counts] = await Promise.all([
        fetchAllEpisodes(tmdbId, seasonNumbers),
        getEpisodeWatchCounts(titleId),
      ]);
      const airedIds = airedOnly(all).map((e) => e.id);
      return { airedIds, passes: seriesPasses(airedIds, counts) };
    },
    enabled: seasonNumbers.length > 0,
  });
  const passes = passesQ.data?.passes ?? 0;

  // The season screen's +/− don't know this key; catch up on coming back.
  const { refetch } = passesQ;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: keys.seriesPasses(titleId) });
    queryClient.invalidateQueries({ queryKey: keys.diary() });
    queryClient.invalidateQueries({ queryKey: keys.stats() });
    queryClient.invalidateQueries({ queryKey: keys.library() });
    queryClient.invalidateQueries({ queryKey: keys.libraryStatus(titleId) });
  };

  async function logSeries() {
    if (busy || seasonNumbers.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const episodes = airedOnly(await fetchAllEpisodes(tmdbId, seasonNumbers));
      if (episodes.length === 0) {
        setMessage('No aired episodes yet');
        hapticFailure();
        return;
      }
      await logManyEpisodeWatches(
        episodes.map((e) => ({ id: e.id, title_id: e.title_id })),
      );
      await setLibraryStatus(titleId, 'completed');
      invalidate();
      // Fires on completion, not on tap: a whole series takes seconds to write,
      // so the buzz *is* the "it's done" signal.
      hapticSuccess();
    } catch {
      setMessage("Couldn't log the episodes. Try again.");
      hapticFailure();
    } finally {
      setBusy(false);
    }
  }

  async function undoPass() {
    const aired = passesQ.data?.airedIds;
    if (busy || !aired || passes === 0) return;
    setBusy(true);
    setMessage(null);
    hapticUndo();
    try {
      const left = await undoSeriesPass(titleId, aired);
      if (passes === 1 && left > 0) await setLibraryStatus(titleId, 'watching');
      invalidate();
    } catch {
      setMessage("Couldn't undo. Try again.");
      hapticFailure();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Pressable
          style={[styles.button, busy && styles.busy]}
          onPress={logSeries}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Log whole series"
          accessibilityState={{ disabled: busy, busy }}>
          <ThemedText style={styles.buttonText}>＋ Log whole series</ThemedText>
        </Pressable>
        {busy && <ActivityIndicator />}
      </View>
      {passes > 0 && (
        <View style={styles.row}>
          <ThemedText type="small">
            Logged {passes} {passes === 1 ? 'time' : 'times'}
          </ThemedText>
          <Pressable
            onPress={undoPass}
            disabled={busy}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Undo one series watch"
            accessibilityState={{ disabled: busy }}>
            <ThemedText type="smallBold" style={{ color: ACTIVE }}>
              Undo
            </ThemedText>
          </Pressable>
        </View>
      )}
      {message && <ThemedText type="small">{message}</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    backgroundColor: ACTIVE,
  },
  busy: { opacity: 0.6 },
  buttonText: { color: AccentText, fontWeight: '600' },
});
