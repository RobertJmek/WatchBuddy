import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { keys } from '@/lib/keys';
import {
  getLibraryStatus,
  removeFromLibrary,
  setLibraryStatus,
  type LibraryStatus,
} from '@/lib/library';
import { fetchAllEpisodes, type SeasonRow } from '@/lib/tmdb';
import { useSessionLog } from '@/lib/use-session-log';
import { airedOnly, logManyEpisodeWatches, removeEpisodeWatchesByIds } from '@/lib/watches';

const ACTIVE = Accent;

/** What one press wrote, so Undo reverses exactly that. */
type SeriesLog = { watchIds: string[]; priorStatus: LibraryStatus | null };

/**
 * "Log whole series": +1 watch on every aired episode, every press, so on a
 * series you've seen it is a rewatch and the counts go up (the same rule as
 * "Log whole season" and the season swipe). Then marks the series Completed,
 * as logging a movie does. Below the button, "Logged N times · Undo" counts
 * this visit's presses; Undo pops the latest one, its rows and its status
 * change (`useSessionLog`, ADR 0011).
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
  const [message, setMessage] = useState<string | null>(null);

  // A full-series watch excludes "Specials" (season 0).
  const seasonNumbers = seasons
    .map((s) => s.season_number)
    .filter((n) => n >= 1)
    .sort((a, b) => a - b);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: keys.diary() });
    queryClient.invalidateQueries({ queryKey: keys.stats() });
    queryClient.invalidateQueries({ queryKey: keys.library() });
    queryClient.invalidateQueries({ queryKey: keys.libraryStatus(titleId) });
  };

  const { logged, log, undo } = useSessionLog<SeriesLog>(async (rows) => {
    await removeEpisodeWatchesByIds(rows.watchIds);
    if (rows.priorStatus) await setLibraryStatus(titleId, rows.priorStatus);
    else await removeFromLibrary(titleId);
    invalidate();
  });
  const stack = logged.get(titleId);
  const pending = stack?.at(-1)?.pending ?? false;

  function logSeries() {
    if (pending || seasonNumbers.length === 0) return;
    setMessage(null);
    log(
      titleId,
      async () => {
        try {
          const episodes = airedOnly(await fetchAllEpisodes(tmdbId, seasonNumbers));
          if (episodes.length === 0) {
            setMessage('No aired episodes yet');
            // Throwing rolls the press back (and buzzes the failure).
            throw new Error('no aired episodes');
          }
          const priorStatus = await getLibraryStatus(titleId);
          const watchIds = await logManyEpisodeWatches(
            episodes.map((e) => ({ id: e.id, title_id: e.title_id })),
          );
          await setLibraryStatus(titleId, 'completed');
          invalidate();
          return { watchIds, priorStatus };
        } catch (e) {
          setMessage((m) => m ?? "Couldn't log the episodes. Try again.");
          throw e;
        }
      },
      { repeat: true },
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Pressable
          style={[styles.button, pending && styles.busy]}
          onPress={logSeries}
          disabled={pending}
          accessibilityRole="button"
          accessibilityLabel="Log whole series"
          accessibilityState={{ disabled: pending, busy: pending }}>
          <ThemedText style={styles.buttonText}>＋ Log whole series</ThemedText>
        </Pressable>
        {pending && <ActivityIndicator />}
      </View>
      {stack ? (
        <View style={styles.row}>
          <ThemedText type="small">
            Logged {stack.length} {stack.length === 1 ? 'time' : 'times'}
          </ThemedText>
          <Pressable
            onPress={() => undo(titleId)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Undo the last series log">
            <ThemedText type="smallBold" style={{ color: ACTIVE }}>
              Undo
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        message && <ThemedText type="small">{message}</ThemedText>
      )}
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
