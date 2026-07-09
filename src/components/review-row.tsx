import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ReviewItem } from '@/lib/ratings';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** A single community review: author, score, text — taps through to the profile. */
export function ReviewRow({ review }: { review: ReviewItem }) {
  const router = useRouter();
  const c = useTheme();
  const name =
    review.display_name?.trim() ||
    (review.username ? `@${review.username}` : 'User');
  const initial = (name.replace('@', '') || '?').charAt(0).toUpperCase();

  return (
    <Pressable
      style={[styles.card, { backgroundColor: c.backgroundElement }]}
      onPress={() =>
        router.push({ pathname: '/user/[id]', params: { id: review.userId } })
      }>
      <View style={styles.top}>
        {review.avatar_url ? (
          <Image
            style={styles.avatar}
            source={{ uri: review.avatar_url }}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <ThemedText style={styles.avatarInitial}>{initial}</ThemedText>
          </View>
        )}
        <View style={styles.who}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {name}
          </ThemedText>
          <ThemedText type="small" style={{ color: c.textSecondary }}>
            {review.username ? `@${review.username}` : ''}
            {review.is_following ? ' · Following' : ''}
          </ThemedText>
        </View>
        <View style={[styles.score, { borderColor: c.glow }]}>
          <ThemedText type="smallBold" style={{ color: c.glow }}>
            {review.value}
          </ThemedText>
        </View>
      </View>

      <ThemedText style={styles.text}>{review.review}</ThemedText>
      <ThemedText type="small" style={[styles.date, { color: c.textSecondary }]}>
        {formatDate(review.updated_at)}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: PlaceholderBg },
  avatarFallback: {
    backgroundColor: Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: AccentText, fontSize: 15, lineHeight: 19, fontWeight: '700' },
  who: { flex: 1 },
  score: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { lineHeight: 21 },
  date: { opacity: 0.8 },
});
