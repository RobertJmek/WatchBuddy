import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ImpliedWatchNote, useImpliedWatch } from '@/components/implied-watch-note';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { hapticFailure, hapticTick, hapticUndo } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import {
  getLibraryStatus,
  LIBRARY_STATUSES,
  removeFromLibrary,
  setLibraryStatus,
  type LibraryStatus,
} from '@/lib/library';

const ACTIVE = Accent;

export function LibraryStatusBar({
  titleId,
  tmdbId,
  mediaType,
}: {
  titleId: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
}) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const implied = useImpliedWatch({ id: titleId, tmdbId, mediaType });

  // Shared source of truth so logging a movie watch (which promotes the title
  // to Completed) can invalidate this key and flip the chip instantly.
  const { data: status, isLoading } = useQuery({
    queryKey: keys.libraryStatus(titleId),
    queryFn: () => getLibraryStatus(titleId),
  });

  async function choose(next: LibraryStatus) {
    if (saving || status === undefined) return;
    const previous = status ?? null;
    // Tapping the active status again removes the title from the library.
    const remove = next === previous;
    queryClient.setQueryData(keys.libraryStatus(titleId), remove ? null : next); // optimistic
    if (remove) hapticUndo();
    else hapticTick();
    setSaving(true);
    try {
      if (remove) await removeFromLibrary(titleId);
      else await setLibraryStatus(titleId, next);
      queryClient.invalidateQueries({ queryKey: keys.library() });
      // Completed means watched (ADR 0024): fill in whatever isn't logged yet —
      // the movie's one watch, or a series' remaining aired episodes.
      if (!remove && next === 'completed')
        void implied.mark({ onlyIfUntouched: false });
    } catch {
      queryClient.setQueryData(keys.libraryStatus(titleId), previous); // revert on failure
      hapticFailure();
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <ActivityIndicator style={{ alignSelf: 'flex-start' }} />;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {LIBRARY_STATUSES.map(({ value, label }) => {
          const selected = status === value;
          return (
            <Pressable
              key={value}
              onPress={() => choose(value)}
              style={[styles.chip, selected && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected }}>
              <ThemedText
                type="small"
                style={selected ? styles.chipTextActive : undefined}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      <ImpliedWatchNote note={implied.note} onUndo={implied.undo} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: ACTIVE,
  },
  chipActive: { backgroundColor: ACTIVE },
  chipTextActive: { color: AccentText },
});
