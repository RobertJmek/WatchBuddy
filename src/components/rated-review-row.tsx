import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressScale } from '@/components/press-scale';
import { ThemedText } from '@/components/themed-text';
import { PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { UserRating } from '@/lib/ratings';
import { imageUrl } from '@/lib/tmdb';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * One of a person's written reviews on their profile: poster, title, score,
 * the first lines of the text. The author is the profile, so unlike
 * `ReviewRow` it names the title instead; it opens the thread, where the likes
 * and replies are.
 */
export const RatedReviewRow = memo(function RatedReviewRow({
  item,
}: {
  item: UserRating;
}) {
  const c = useTheme();
  const router = useRouter();
  return (
    <PressScale
      style={[styles.row, { backgroundColor: c.backgroundElement }]}
      onPress={() =>
        router.push({
          pathname: '/review/[ratingId]',
          params: { ratingId: item.ratingId },
        })
      }
      accessibilityRole="button"
      // The start of the text, like the three lines on screen — not all 2,000 characters.
      accessibilityLabel={`Review of ${item.title.title}, rated ${item.value}. ${(item.review ?? '').slice(0, 160)}`}
      accessibilityHint="Opens the review thread">
      <Image
        style={styles.poster}
        source={{ uri: imageUrl(item.title.poster_path, 'w185') ?? undefined }}
        contentFit="cover"
        transition={150}
      />
      <View style={styles.body}>
        <View style={styles.head}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
            {item.title.title}
          </ThemedText>
          <View style={[styles.score, { borderColor: c.glow }]}>
            <ThemedText type="smallBold" style={{ color: c.glow }}>
              {item.value}
            </ThemedText>
          </View>
        </View>
        <ThemedText type="small" numberOfLines={3} style={styles.text}>
          {item.review}
        </ThemedText>
        <ThemedText type="small" style={{ color: c.textSecondary }}>
          {formatDate(item.updatedAt)}
        </ThemedText>
      </View>
    </PressScale>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Spacing.three,
  },
  poster: {
    width: 52,
    height: 78,
    borderRadius: Spacing.one,
    backgroundColor: PlaceholderBg,
  },
  body: { flex: 1, gap: Spacing.half },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1 },
  score: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { lineHeight: 19 },
});
