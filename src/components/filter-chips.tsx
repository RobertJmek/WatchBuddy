import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { IconSymbol } from '@/components/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticToggle } from '@/lib/haptics';
import {
  chipsFor,
  EMPTY_FILTER,
  removeChip,
  type LibraryFilter,
} from '@/lib/library-filter';

/**
 * The active filter, spelled out as removable chips under the header. Two jobs:
 * it says *why* the screen is showing less than everything (a shelf vanishing
 * is otherwise indistinguishable from an emptied Watchlist), and it undoes one
 * axis at a time without reopening the sheet.
 *
 * Renders nothing when no filter is active, so callers can mount it
 * unconditionally.
 */
export function FilterChips({
  filter,
  genreNames,
  onChange,
}: {
  filter: LibraryFilter;
  genreNames: Map<number, string>;
  onChange: (next: LibraryFilter) => void;
}) {
  const c = useTheme();
  const chips = chipsFor(filter, genreNames);
  if (chips.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
      contentContainerStyle={styles.chips}>
      {chips.map((chip) => (
        <Pressable
          key={chip.key}
          hitSlop={4}
          onPress={() => {
            hapticToggle(false);
            onChange(removeChip(filter, chip.key));
          }}
          style={[styles.chip, { backgroundColor: c.backgroundElement }]}>
          <ThemedText type="small">{chip.label}</ThemedText>
          <IconSymbol name="xmark" size={12} tintColor={c.textSecondary} />
        </Pressable>
      ))}
      <View style={styles.divider} />
      <Pressable
        hitSlop={4}
        onPress={() => {
          hapticToggle(false);
          onChange(EMPTY_FILTER);
        }}
        style={styles.clear}>
        <ThemedText type="small" style={{ color: c.tint }}>
          Clear
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, marginBottom: Spacing.two },
  chips: { gap: Spacing.two, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 999,
  },
  divider: { width: 1 },
  clear: { paddingHorizontal: Spacing.one, paddingVertical: Spacing.one },
});
