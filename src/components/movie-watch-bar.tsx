import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import {
  getMovieWatches,
  logMovieWatch,
  removeMovieWatch,
  type MovieWatch,
} from '@/lib/watches';

const ACTIVE = Accent;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

export function MovieWatchBar({ titleId }: { titleId: string }) {
  const queryClient = useQueryClient();
  const [watches, setWatches] = useState<MovieWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setWatches(await getMovieWatches(titleId));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleId]);

  async function log() {
    if (busy) return;
    setBusy(true);
    try {
      await logMovieWatch(titleId);
      await load();
      queryClient.invalidateQueries({ queryKey: ['diary'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      // logMovieWatch also promoted the title to Completed — refresh the status
      // chips on this screen and the Library list so both reflect it.
      queryClient.invalidateQueries({ queryKey: ['libraryStatus', titleId] });
      queryClient.invalidateQueries({ queryKey: ['library'] });
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (busy || watches.length === 0) return;
    setBusy(true);
    try {
      await removeMovieWatch(watches[0].id);
      await load();
      queryClient.invalidateQueries({ queryKey: ['diary'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <ActivityIndicator style={{ alignSelf: 'flex-start' }} />;

  return (
    <View style={styles.container}>
      <Pressable
        style={[styles.button, busy && styles.buttonBusy]}
        onPress={log}
        disabled={busy}>
        <ThemedText style={styles.buttonText}>＋ Log watch</ThemedText>
      </Pressable>

      {watches.length > 0 && (
        <View style={styles.meta}>
          <ThemedText type="small">
            Watched {watches.length}×{' '}
            {watches.length > 0 ? `· last ${formatDate(watches[0].watched_at)}` : ''}
          </ThemedText>
          <Pressable onPress={undo} disabled={busy}>
            <ThemedText type="small" style={styles.undo}>
              Undo last
            </ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    backgroundColor: ACTIVE,
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: AccentText, fontWeight: '600' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  undo: { color: ACTIVE },
});
