import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressScale } from '@/components/press-scale';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticTick } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import { getTrending, imageUrl, type SearchResult } from '@/lib/tmdb';

const POSTER_W = 92;
const POSTER_H = 138;
const GAP = 12;
const PER_ROW = 7;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const rise = (step: number) => FadeInDown.duration(500).delay(200 + step * 90).easing(EASE_OUT);

/**
 * First stop for a new account (ADR 0028): a slow wall of this week's posters,
 * then one line on what WatchBuddy is. Then the profile step, then the
 * tutorial. Reached from the first-run gate in `(app)/_layout.tsx`.
 */
export default function WelcomeScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Same query and key as Search's shelves, so it is usually a cache hit.
  const trending = useQuery({
    queryKey: keys.trending(),
    queryFn: getTrending,
    staleTime: 1000 * 60 * 60 * 24,
  });
  const posters = [...(trending.data?.movies ?? []), ...(trending.data?.tv ?? [])].filter(
    (t) => t.poster_path,
  );

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View
        style={[styles.wall, { paddingTop: insets.top + Spacing.three }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {[0, 1, 2].map((row) => (
          <PosterRow
            key={row}
            items={posters.slice(row * PER_ROW, (row + 1) * PER_ROW)}
            reverse={row % 2 === 1}
          />
        ))}
        {/* Softens the wall's bottom edge on phones too short for three rows.
            The text starts below the wall, never on top of it. */}
        <LinearGradient
          colors={[`${c.background}00`, c.background]}
          style={styles.fade}
          pointerEvents="none"
        />
      </View>

      <Animated.View entering={rise(0)} style={styles.intro}>
        <ThemedText type="title" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          Welcome to WatchBuddy
        </ThemedText>
        <ThemedText style={[styles.body, { color: c.textSecondary }]}>
          Track what you watch and see what your friends are watching.
        </ThemedText>
      </Animated.View>

      <Animated.View
        entering={rise(1)}
        style={[styles.bottom, { paddingBottom: insets.bottom + Spacing.three }]}>
        <PressScale
          style={styles.button}
          onPress={() => {
            hapticTick();
            router.replace('/onboarding');
          }}
          accessibilityRole="button">
          <ThemedText style={styles.buttonText}>Get started</ThemedText>
        </PressScale>
      </Animated.View>
    </ThemedView>
  );
}

/**
 * One row of the wall, drifting slowly sideways and back (rows alternate
 * direction). Decorative only. Grey tiles stand in until the feed arrives,
 * and the row holds still under Reduce Motion.
 */
function PosterRow({ items, reverse }: { items: SearchResult[]; reverse: boolean }) {
  const reduced = useReducedMotion();
  const tiles = items.length ? items : Array.from({ length: PER_ROW }, () => null);
  const drift = (POSTER_W + GAP) * 2;
  return (
    <Animated.View
      entering={FadeIn.duration(600)}
      style={[
        styles.row,
        { marginLeft: reverse ? -drift : -GAP },
        !reduced && {
          animationName: {
            from: { transform: [{ translateX: reverse ? drift : 0 }] },
            to: { transform: [{ translateX: reverse ? 0 : -drift }] },
          },
          animationDuration: '24s',
          animationIterationCount: 'infinite',
          animationDirection: 'alternate',
          animationTimingFunction: 'ease-in-out',
        },
      ]}>
      {tiles.map((t, i) =>
        t ? (
          <Image
            key={`${t.media_type}-${t.tmdb_id}`}
            source={{ uri: imageUrl(t.poster_path, 'w185') ?? undefined }}
            style={styles.poster}
            contentFit="cover"
            transition={300}
          />
        ) : (
          <View key={i} style={[styles.poster, { backgroundColor: PlaceholderBg }]} />
        ),
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Three full rows; it gives way (and the fade softens the cut) on short phones.
  wall: { flexShrink: 1, overflow: 'hidden', gap: GAP },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 32 },
  row: { flexDirection: 'row', gap: GAP },
  poster: { width: POSTER_W, height: POSTER_H, borderRadius: Spacing.two },
  // Same measures as a tutorial card: 24pt sides, 12pt inside the group.
  intro: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.five, gap: 12 },
  body: { fontSize: 17, lineHeight: 26 },
  bottom: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  button: {
    backgroundColor: Accent,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonText: { color: AccentText, fontWeight: '700', fontSize: 16 },
});
