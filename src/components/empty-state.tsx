import { StyleSheet, View } from 'react-native';

import { IconSymbol, type IconName } from '@/components/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Centered icon + title + optional hint, for empty lists and no-result searches. */
export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: IconName;
  title: string;
  hint?: string;
}) {
  const c = useTheme();
  return (
    <View style={styles.wrap}>
      <IconSymbol name={icon} size={28} tintColor={c.textSecondary} />
      <ThemedText type="smallBold" style={{ color: c.textSecondary }}>
        {title}
      </ThemedText>
      {hint ? (
        <ThemedText type="small" style={[styles.hint, { color: c.textSecondary }]}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.five,
    paddingHorizontal: Spacing.four,
  },
  hint: { textAlign: 'center', opacity: 0.8 },
});
