import { ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';

import { PressScale } from '@/components/press-scale';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Danger, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'primary' | 'outline' | 'danger';

/** Pill button in the three shapes the app uses: filled accent, quiet outline, danger outline. */
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const c = useTheme();
  const inactive = disabled || loading;
  const byVariant: Record<Variant, { box: ViewStyle; text: string }> = {
    primary: { box: { backgroundColor: Accent }, text: AccentText },
    outline: { box: { borderWidth: 1, borderColor: c.border }, text: c.tint },
    danger: { box: { borderWidth: 1, borderColor: Danger }, text: Danger },
  };
  const v = byVariant[variant];
  return (
    <PressScale
      onPress={onPress}
      disabled={inactive}
      style={[styles.base, v.box, inactive && styles.inactive, style]}>
      {loading ? (
        <ActivityIndicator color={v.text} />
      ) : (
        <ThemedText type="smallBold" style={{ color: v.text }}>
          {title}
        </ThemedText>
      )}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inactive: { opacity: 0.6 },
});
