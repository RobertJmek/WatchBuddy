import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { hapticFailure, hapticSuccess } from '@/lib/haptics';
import { fetchAllEpisodes, type EpisodeRow, type SeasonRow } from '@/lib/tmdb';
import { keys } from '@/lib/keys';
import { airedOnly, getEpisodeWatchCounts, logManyEpisodeWatches } from '@/lib/watches';

const ACTIVE = Accent;

const plural = (n: number) => `${n} episode${n === 1 ? '' : 's'}`;

/**
 * "Log whole series": fills in every aired episode you haven't logged yet (the
 * same rule a rating or Completed follows, ADR 0024), after a confirmation that
 * names the count — it can be hundreds of rows, and there is no undo here.
 * Episodes you already watched are left alone; when every aired one is logged,
 * there is nothing to do.
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

  async function write(episodes: EpisodeRow[]) {
    try {
      await logManyEpisodeWatches(
        episodes.map((e) => ({ id: e.id, title_id: e.title_id })),
      );
      queryClient.invalidateQueries({ queryKey: keys.diary() });
      queryClient.invalidateQueries({ queryKey: keys.stats() });
      setMessage(`Logged ${plural(episodes.length)}`);
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

  async function logSeries() {
    if (busy || seasonNumbers.length === 0) return;
    setBusy(true);
    setMessage(null);
    let aired: EpisodeRow[];
    let todo: EpisodeRow[];
    try {
      const [all, counts] = await Promise.all([
        fetchAllEpisodes(tmdbId, seasonNumbers),
        getEpisodeWatchCounts(titleId),
      ]);
      aired = airedOnly(all);
      todo = aired.filter((e) => !counts.has(e.id));
    } catch {
      setMessage("Couldn't load the episodes. Try again.");
      hapticFailure();
      setBusy(false);
      return;
    }
    if (todo.length === 0) {
      setMessage(aired.length === 0 ? 'No aired episodes yet' : "You've watched every aired episode");
      setBusy(false);
      return;
    }
    Alert.alert(
      `Log ${plural(todo.length)}?`,
      "Every aired episode you haven't logged yet. Episodes you already watched stay as they are.",
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setBusy(false) },
        { text: 'Log', onPress: () => void write(todo) },
      ],
      { cancelable: true, onDismiss: () => setBusy(false) },
    );
  }

  return (
    <View style={styles.container}>
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
      {message && <ThemedText type="small">{message}</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
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
