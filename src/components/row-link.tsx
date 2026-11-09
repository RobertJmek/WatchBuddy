import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type AccessibilityRole } from 'react-native';

import { IconSymbol } from '@/components/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * One tappable row of a settings-type list (ADR 0030): a 17/24 semibold label,
 * an optional note under it, an optional value on the right, then a chevron.
 * Rows sit in a group; the group, not the row, owns the 32pt gap to the next one.
 */
export function RowLink({
  label,
  note,
  value,
  onPress,
  disabled,
  busy,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  note?: string;
  value?: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      style={[styles.row, { borderBottomColor: c.border }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint ?? note}
      accessibilityState={{ disabled, busy }}>
      <View style={styles.text}>
        <ThemedText type="label">{label}</ThemedText>
        {note && (
          <ThemedText type="small" style={{ color: c.textSecondary }}>
            {note}
          </ThemedText>
        )}
      </View>
      {typeof value === 'string' ? (
        <ThemedText type="small" style={{ color: c.textSecondary }}>
          {value}
        </ThemedText>
      ) : (
        value
      )}
      {busy ? (
        <ActivityIndicator size="small" />
      ) : (
        <IconSymbol name="chevron.right" size={18} tintColor={c.textSecondary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: Spacing.half },
});
