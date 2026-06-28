import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
import {
  getLibraryStatus,
  LIBRARY_STATUSES,
  removeFromLibrary,
  setLibraryStatus,
  type LibraryStatus,
} from '@/lib/library';

const ACTIVE = Accent;

export function LibraryStatusBar({ titleId }: { titleId: string }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getLibraryStatus(titleId)
      .then((s) => active && setStatus(s))
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [titleId]);

  async function choose(next: LibraryStatus) {
    if (saving) return;
    const previous = status;
    // Tapping the active status again removes the title from the library.
    const remove = next === previous;
    setStatus(remove ? null : next); // optimistic
    setSaving(true);
    try {
      if (remove) await removeFromLibrary(titleId);
      else await setLibraryStatus(titleId, next);
      queryClient.invalidateQueries({ queryKey: ['library'] });
    } catch {
      setStatus(previous); // revert on failure
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <ActivityIndicator style={{ alignSelf: 'flex-start' }} />;

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
  chipTextActive: { color: '#fff' },
});
