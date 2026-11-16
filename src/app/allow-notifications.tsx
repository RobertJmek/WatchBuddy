import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarButton, BottomBar } from '@/components/bottom-bar';
import { Intro } from '@/components/intro';
import { Pressable } from '@/components/pressable';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { enablePush, getPushPermission } from '@/lib/push';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const rise = (step: number) => FadeInDown.duration(450).delay(step * 80).easing(EASE_OUT);

const SAMPLES = [
  { head: 'Ana replied to your review on Dune', body: '“That ending though.”' },
  { head: null, body: 'Ana and 3 others liked your review on Dune' },
];

/**
 * A new account's notification step, between the profile step and the
 * tutorial (ADR 0039). Our own explanation comes first and the system prompt
 * only after "Turn on": iOS asks once, ever, so the one ask should come with the
 * reason. A phone that has already answered skips straight past it.
 */
export default function AllowNotificationsScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const next = () => router.replace('/tutorial');

  useEffect(() => {
    getPushPermission().then(
      (p) => p !== 'undetermined' && router.replace('/tutorial'),
      () => router.replace('/tutorial'),
    );
  }, [router]);

  async function turnOn() {
    setBusy(true);
    // Whatever the answer, the flow goes on; Profile → Notifications can change it.
    await enablePush().catch(() => {});
    next();
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={[styles.top, { paddingTop: insets.top + Spacing.two }]}>
        <Pressable
          onPress={next}
          disabled={busy}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Skip for now"
          accessibilityState={{ disabled: busy }}>
          <ThemedText type="smallBold" style={{ color: c.textSecondary }}>
            Skip
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.content}>
        <Intro
          entering={rise(0)}
          title="Notifications"
          body="Know when someone replies to your review or follows you. You can change this later."
        />
        {/* What a notification will look like — the reason to say yes. */}
        <View
          style={styles.samples}
          accessible
          accessibilityLabel="Example: Ana replied to your review on Dune">
          {SAMPLES.map((s, i) => (
            <Animated.View
              key={s.body}
              entering={rise(i + 1)}
              style={[styles.card, { backgroundColor: c.backgroundElement }]}>
              <Image source={require('@/assets/images/icon.png')} style={styles.icon} />
              <View style={styles.cardText}>
                <View style={styles.cardHead}>
                  <ThemedText type="smallBold">WatchBuddy</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    now
                  </ThemedText>
                </View>
                {s.head && <ThemedText type="smallBold">{s.head}</ThemedText>}
                <ThemedText type="small">{s.body}</ThemedText>
              </View>
            </Animated.View>
          ))}
        </View>
      </View>

      <BottomBar entering={rise(3)}>
        <BarButton title="Turn on notifications" onPress={turnOn} busy={busy} />
      </BottomBar>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { alignItems: 'flex-end', paddingHorizontal: Spacing.four },
  content: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.two, gap: Spacing.five },
  samples: { gap: 12 },
  card: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 16 },
  icon: { width: 36, height: 36, borderRadius: 8 },
  cardText: { flex: 1, gap: 2 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between' },
});
