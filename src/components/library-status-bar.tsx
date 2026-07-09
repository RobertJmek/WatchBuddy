import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import {
  getLibraryStatus,
  LIBRARY_STATUSES,
  removeFromLibrary,
  setLibraryStatus,
  type LibraryStatus,
} from '@/lib/library';

const ACTIVE = Accent;

const STATUS_KEY = (titleId: string) => ['libraryStatus', titleId];

export function LibraryStatusBar({ titleId }: { titleId: string }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  // Shared source of truth so logging a movie watch (which promotes the title
  // to Completed) can invalidate this key and flip the chip instantly.
  const { data: status, isLoading } = useQuery({
    queryKey: STATUS_KEY(titleId),
    queryFn: () => getLibraryStatus(titleId),
  });

  async function choose(next: LibraryStatus) {
    if (saving || status === undefined) return;
    const previous = status ?? null;
    // Tapping the active status again removes the title from the library.
    const remove = next === previous;
    queryClient.setQueryData(STATUS_KEY(titleId), remove ? null : next); // optimistic
    setSaving(true);
    try {
      if (remove) await removeFromLibrary(titleId);
      else await setLibraryStatus(titleId, next);
      queryClient.invalidateQueries({ queryKey: ['library'] });
    } catch {
      queryClient.setQueryData(STATUS_KEY(titleId), previous); // revert on failure
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <ActivityIndicator style={{ alignSelf: 'flex-start' }} />;

  return (
    <View style={styles.row}>
      {LIBRARY_STATUSES.map(({ value, label }) => {
        const selected = status === value;
        return (
          <Pressable
            key={value}
            onPress={() => choose(value)}
            style={[styles.chip, selected && styles.chipActive]}>
            <ThemedText
              type="small"
              style={selected ? styles.chipTextActive : undefined}>
              {label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
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
