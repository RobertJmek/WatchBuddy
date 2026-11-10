import { ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';

import { PressScale } from '@/components/press-scale';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'primary' | 'outline' | 'danger';

/**
 * The app's full-width button: a filled accent, or a quiet neutral fill whose
 * text carries the meaning (`outline` in teal, `danger` in red). Corners match
 * the fields and cards it lines up with.
 */
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
    outline: { box: { backgroundColor: c.backgroundElement }, text: c.tint },
    danger: { box: { backgroundColor: c.backgroundElement }, text: c.danger },
  };
  const v = byVariant[variant];
  return (
    <PressScale
      onPress={onPress}
      disabled={inactive}
      style={[styles.base, v.box, inactive && styles.inactive, style]}
      accessibilityRole="button"
      // The title is a child, but not while loading — the spinner replaces it,
      // and an unlabelled spinner is what a reader would otherwise announce.
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}>
      {loading ? (
        <ActivityIndicator color={v.text} />
      ) : (
        <ThemedText type="label" style={{ color: v.text }}>
          {title}
        </ThemedText>
      )}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inactive: { opacity: 0.6 },
});
