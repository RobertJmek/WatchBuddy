import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticFailure, hapticSuccess, hapticUndo } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import { ensureWatched, undoImpliedWatch, type ImpliedWatch } from '@/lib/watches';

/** How long the note (and its Undo) stays after an implied watch lands. */
const NOTE_MS = 5000;

type ImpliedTitle = { id: string; tmdbId: number; mediaType: 'movie' | 'tv' };

type NoteState =
  | { kind: 'logged'; watch: ImpliedWatch }
  | { kind: 'failed' }
  | null;

/**
 * Rating a title or marking it Completed also counts it as watched (ADR 0024).
 * `mark()` runs `ensureWatched` in the background and leaves a short note with
 * an Undo that reverses exactly what it wrote. A failure never touches the
 * rating or status that triggered it — it only says so.
 */
export function useImpliedWatch(title: ImpliedTitle) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState<NoteState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function show(next: NoteState) {
    if (timer.current) clearTimeout(timer.current);
    setNote(next);
    if (next) timer.current = setTimeout(() => setNote(null), NOTE_MS);
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: keys.diary() });
    queryClient.invalidateQueries({ queryKey: keys.stats() });
    queryClient.invalidateQueries({ queryKey: keys.library() });
    queryClient.invalidateQueries({ queryKey: keys.libraryStatus(title.id) });
    queryClient.invalidateQueries({ queryKey: keys.movieWatches(title.id) });
  }

  async function mark(opts: { onlyIfUntouched: boolean }) {
    try {
      const watch = await ensureWatched(title, opts);
      if (!watch) return;
      invalidate();
      show({ kind: 'logged', watch });
      hapticSuccess();
    } catch {
      show({ kind: 'failed' });
      hapticFailure();
    }
  }

  async function undo() {
    if (note?.kind !== 'logged') return;
    const { watch } = note;
    show(null);
    hapticUndo();
    try {
      await undoImpliedWatch(watch);
      invalidate();
    } catch {
      hapticFailure();
    }
  }

  return { note, mark, undo };
}

export function ImpliedWatchNote({
  note,
  onUndo,
}: {
  note: NoteState;
  onUndo: () => void;
}) {
  const c = useTheme();
  if (!note) return null;

  if (note.kind === 'failed') {
    return (
      <ThemedText type="small" style={{ color: c.textSecondary }}>
        Couldn&apos;t mark it as watched
      </ThemedText>
    );
  }

  const n = note.watch.watchIds.length;
  const text =
    note.watch.kind === 'movie'
      ? 'Marked as watched'
      : `Logged ${n} episode${n === 1 ? '' : 's'}`;
  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <ThemedText type="small" style={{ color: c.textSecondary }}>
        {text}
      </ThemedText>
      <Pressable
        onPress={onUndo}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Undo: ${text.toLowerCase()}`}>
        <ThemedText type="small" style={styles.undo}>
          Undo
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  undo: { color: Accent, fontWeight: '600' },
});
