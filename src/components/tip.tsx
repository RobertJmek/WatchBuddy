import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Pressable } from '@/components/pressable';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { markTipDone, useTipVisible, type TipId } from '@/lib/onboarding';

/**
 * One line about a gesture nothing on screen gives away, placed where the
 * gesture works (ADR 0034). It leaves for good once the user does the gesture
 * (the screen calls `markTipDone`) or taps "Got it". One per screen.
 */
export function Tip({ id, text, style }: { id: TipId; text: string; style?: ViewStyle }) {
  const c = useTheme();
  if (!useTipVisible(id)) return null;
  return (
    <View style={[styles.tip, { backgroundColor: c.backgroundElement }, style]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
        {text}
      </ThemedText>
      <Pressable
        onPress={() => markTipDone(id)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Got it">
        <ThemedText type="smallBold" themeColor="tint">
          Got it
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: Spacing.three,
  },
  text: { flex: 1 },
});
