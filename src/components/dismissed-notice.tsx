import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * What sits in a dismissed notification's place for a few seconds: the receipt
 * for a gesture that just made something disappear, and the way back from it.
 *
 * It stands in the row's own position rather than at the top or bottom of the
 * screen, because that's where you were looking when it happened — and it saves
 * the project a global snackbar it doesn't otherwise need. Same height and
 * radius as a notification row, so the list doesn't jump.
 */
export function DismissedNotice({ onUndo }: { onUndo: () => void }) {
  const c = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: c.backgroundElement }]}>
      <ThemedText type="small" style={{ color: c.textSecondary }}>
        Dismissed
      </ThemedText>
      <Pressable onPress={onUndo} hitSlop={10}>
        <ThemedText type="smallBold" style={{ color: c.tint }}>
          Undo
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
});
