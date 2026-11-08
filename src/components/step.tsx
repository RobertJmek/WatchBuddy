import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, LinearTransition } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const layout = LinearTransition.duration(220).easing(Easing.bezier(0.23, 1, 0.32, 1));

/**
 * One instruction and the control it is about: a short semibold label (with a
 * number when a screen has several), an optional note, then the control 12pt
 * below. The tutorial cards and the profile step share it. A changed label
 * fades in, so a label can follow the state ("Swipe it right" → "Logged").
 */
export function Step({
  n,
  label,
  note,
  children,
}: {
  n?: number;
  label: string;
  note?: string;
  children: ReactNode;
}) {
  const c = useTheme();
  return (
    <Animated.View layout={layout} style={styles.step}>
      <View style={styles.head}>
        <View style={styles.labelRow}>
          {n != null && (
            <View style={styles.num}>
              <ThemedText style={styles.numText}>{n}</ThemedText>
            </View>
          )}
          <Animated.View key={label} entering={FadeIn.duration(220)} style={styles.labelWrap}>
            <ThemedText type="label">{label}</ThemedText>
          </Animated.View>
        </View>
        {note && (
          <ThemedText type="small" style={[n != null && styles.noteIndent, { color: c.textSecondary }]}>
            {note}
          </ThemedText>
        )}
      </View>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  step: { gap: 12 },
  head: { gap: Spacing.one },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  num: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: { color: AccentText, fontFamily: Type.semibold, fontSize: 13, lineHeight: 16 },
  labelWrap: { flexShrink: 1 },
  noteIndent: { marginLeft: 34 },
});
