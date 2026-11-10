import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import Animated, { type AnimatedProps } from 'react-native-reanimated';

import { PressScale } from '@/components/press-scale';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { useBottomGap } from '@/hooks/use-bottom-gap';
import { useTheme } from '@/hooks/use-theme';

/**
 * The pinned bottom of a card screen (ADR 0030): 24pt sides and the app's
 * bottom gap, so its button is never lower than Edit Profile's Delete account.
 */
export function BottomBar({
  children,
  entering,
  divided,
}: {
  children: ReactNode;
  /** A hairline on top, for a bar that content scrolls under. */
  divided?: boolean;
  entering?: AnimatedProps<ViewProps>['entering'];
}) {
  const bottomGap = useBottomGap();
  const c = useTheme();
  return (
    <Animated.View
      entering={entering}
      style={[
        styles.bar,
        { paddingBottom: bottomGap },
        divided && [styles.divided, { borderTopColor: c.border }],
      ]}>
      {children}
    </Animated.View>
  );
}

/**
 * The card screens' full-width button, in the same shape and type as `Button`
 * (ADR 0032): a teal fill for the primary action, or a quiet neutral fill for a
 * secondary one beside it (the cropper's Cancel). `busy` keeps
 * it pressable-looking but inert and says so to a screen reader.
 */
export function BarButton({
  title,
  onPress,
  secondary,
  busy,
  disabled,
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const c = useTheme();
  const inactive = disabled || busy;
  const textColor = secondary ? c.text : AccentText;
  return (
    <PressScale
      style={[
        styles.button,
        secondary ? { backgroundColor: c.backgroundElement } : styles.primary,
        inactive && styles.inactive,
        style,
      ]}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy }}>
      <View style={styles.inner}>
        {busy && <ActivityIndicator size="small" color={textColor} />}
        <ThemedText type="label" style={{ color: textColor }}>
          {title}
        </ThemedText>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, gap: Spacing.three },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three },
  button: { borderRadius: Spacing.three, paddingVertical: Spacing.three, alignItems: 'center' },
  primary: { backgroundColor: Accent },
  inactive: { opacity: 0.6 },
  inner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
