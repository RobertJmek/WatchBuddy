import type { ReactNode } from 'react';
import { StyleSheet, type ViewProps } from 'react-native';
import Animated, { type AnimatedProps } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

/**
 * The title block of a card screen (ADR 0028, 0030): a Bodoni title that stays
 * on one line on every phone (the type shrinks before it wraps), then one or two
 * sentences of 17/26 secondary text. On a pushed screen it replaces the header
 * title, so the two never repeat each other.
 */
export function Intro({
  title,
  body,
  entering,
}: {
  title: string;
  /** Plain text, or text with nested `ThemedText` spans. */
  body?: ReactNode;
  entering?: AnimatedProps<ViewProps>['entering'];
}) {
  const c = useTheme();
  return (
    <Animated.View entering={entering} style={styles.intro}>
      <ThemedText
        type="title"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        accessibilityRole="header">
        {title}
      </ThemedText>
      {body != null && (
        <ThemedText style={[styles.body, { color: c.textSecondary }]}>{body}</ThemedText>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 12 },
  body: { fontSize: 17, lineHeight: 26 },
});
