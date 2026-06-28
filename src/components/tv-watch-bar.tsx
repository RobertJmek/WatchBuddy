import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
import { fetchAllEpisodes, type SeasonRow } from '@/lib/tmdb';
import { logManyEpisodeWatches } from '@/lib/watches';

const ACTIVE = Accent;

export function TvWatchBar({
  tmdbId,
  seasons,
}: {
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

  async function logSeries() {
    if (busy || seasonNumbers.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const episodes = await fetchAllEpisodes(tmdbId, seasonNumbers);
      await logManyEpisodeWatches(
        episodes.map((e) => ({ id: e.id, title_id: e.title_id })),
      );
      queryClient.invalidateQueries({ queryKey: ['diary'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      setMessage(`Logged ${episodes.length} episodes`);
    } catch (e) {
      setMessage(`Could not log: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Pressable
        style={[styles.button, busy && styles.busy]}
        onPress={logSeries}
        disabled={busy}>
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
  buttonText: { color: '#fff', fontWeight: '600' },
});
