import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/pressable';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { hapticFailure, hapticSuccess, hapticUndo } from '@/lib/haptics';
import { keys } from '@/lib/keys';
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

/** The log button, with a spinner beside it while a write is in flight. */
export function WatchButton({
  label,
  busy,
  onPress,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        style={[styles.button, busy && styles.buttonBusy]}
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy, busy }}>
        <ThemedText style={styles.buttonText}>＋ {label}</ThemedText>
      </Pressable>
      {busy && <ActivityIndicator />}
    </View>
  );
}

/** "Watched N× · last <date>   Undo last", shared by the movie and series bars. */
export function WatchSummary({
  count,
  lastAt,
  busy,
  onUndo,
  undoLabel,
}: {
  count: number;
  lastAt: string | null;
  busy: boolean;
  onUndo: () => void;
  undoLabel: string;
}) {
  if (count === 0) return null;
  return (
    <View style={styles.row}>
      <ThemedText type="small">
        Watched {count}×{lastAt ? ` · last ${formatDate(lastAt)}` : ''}
      </ThemedText>
      <Pressable
        onPress={onUndo}
        disabled={busy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={undoLabel}
        accessibilityState={{ disabled: busy }}>
        <ThemedText type="small" themeColor="tint">
          Undo last
        </ThemedText>
      </Pressable>
    </View>
  );
}

export function MovieWatchBar({ titleId }: { titleId: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  // A query rather than local state, so a watch logged from elsewhere on the
  // screen — rating the title, or marking it Completed (ADR 0024) — shows up.
  const key = keys.movieWatches(titleId);
  const watchesQ = useQuery({
    queryKey: key,
    queryFn: () => getMovieWatches(titleId),
  });
  const watches = watchesQ.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: keys.diary() });
    queryClient.invalidateQueries({ queryKey: keys.stats() });
    // logMovieWatch also promotes the title to Completed — refresh the status
    // chips on this screen and the Library list so both reflect it.
    queryClient.invalidateQueries({ queryKey: keys.libraryStatus(titleId) });
    queryClient.invalidateQueries({ queryKey: keys.library() });
  };

  // Optimistic: the count changes on the tap, the write follows, and a failed
  // write puts the list back.
  async function write(next: MovieWatch[], run: () => Promise<unknown>) {
    setBusy(true);
    await queryClient.cancelQueries({ queryKey: key });
    const prev = queryClient.getQueryData<MovieWatch[]>(key);
    queryClient.setQueryData(key, next);
    try {
      await run();
    } catch {
      queryClient.setQueryData(key, prev);
      hapticFailure();
    } finally {
      setBusy(false);
      invalidate();
    }
  }

  function log() {
    if (busy) return;
    hapticSuccess();
    void write(
      [{ id: 'pending', watched_at: new Date().toISOString() }, ...watches],
      async () => {
        const id = await logMovieWatch(titleId);
        // Swap in the real id, so an Undo before the refetch deletes the right row.
        queryClient.setQueryData<MovieWatch[]>(key, (w) =>
          w?.map((x) => (x.id === 'pending' ? { ...x, id } : x)),
        );
      },
    );
  }

  function undo() {
    if (busy || watches.length === 0) return;
    hapticUndo();
    void write(watches.slice(1), () => removeMovieWatch(watches[0].id));
  }

  return (
    <View style={styles.container}>
      <WatchButton label="Log watch" busy={busy} onPress={log} />
      <WatchSummary
        count={watches.length}
        lastAt={watches[0]?.watched_at ?? null}
        busy={busy}
        onUndo={undo}
        undoLabel="Undo last watch"
      />
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
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: AccentText, fontWeight: '600' },
});
