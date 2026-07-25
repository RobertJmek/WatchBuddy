import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatEventTime } from '@/components/feed-row';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type NotificationItem } from '@/lib/notifications';

/** "and N others" for an aggregated row (likes, follows); '' for a single actor. */
function others(count: number) {
  if (count <= 1) return '';
  return `and ${count - 1} ${count === 2 ? 'other' : 'others'} `;
}

function copyFor(n: NotificationItem) {
  if (n.type === 'follow') return `${others(n.count)}followed you`;
  const where = n.title ? ` on ${n.title}` : '';
  if (n.type === 'like') {
    return `${others(n.count)}liked your review${where}`;
  }
  return n.replyToComment
    ? `replied to your comment${where}`
    : `replied to your review${where}`;
}

/**
 * A personal notification: a like/reply on the viewer's own review, or someone
 * following them. Pinned at the top of the Feed. The avatar always taps to the
 * actor's profile; the row taps to the review thread (`/review/[ratingId]`, a
 * root route that covers the tab bar, consistent with the Feed's other review
 * taps) -- except a follow, which has no review and goes to the profile too.
 */
export function NotificationRow({ item }: { item: NotificationItem }) {
  const c = useTheme();
  const router = useRouter();
  const openActor = () =>
    router.push({ pathname: '/user/[id]', params: { id: item.actorId } });
  return (
    <Pressable
      style={[
        styles.row,
        { backgroundColor: c.backgroundElement },
        item.unread && { backgroundColor: c.backgroundSelected },
      ]}
      onPress={() =>
        item.ratingId
          ? router.push({
              pathname: '/review/[ratingId]',
              params: { ratingId: item.ratingId },
            })
          : openActor()
      }>
      <Pressable hitSlop={6} onPress={openActor}>
        {item.actorAvatarUrl ? (
          <Image
            style={styles.avatar}
            source={{ uri: item.actorAvatarUrl }}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <ThemedText style={styles.avatarInitial}>
              {item.actorName.replace('@', '').charAt(0).toUpperCase()}
            </ThemedText>
          </View>
        )}
      </Pressable>
      <View style={styles.body}>
        <ThemedText type="small" style={styles.message}>
          <ThemedText type="smallBold">{item.actorName}</ThemedText>{' '}
          {copyFor(item)}
        </ThemedText>
        <ThemedText type="small" style={{ color: c.textSecondary }}>
          {formatEventTime(item.created_at)}
        </ThemedText>
      </View>
      {item.unread && <View style={[styles.dot, { backgroundColor: Accent }]} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: PlaceholderBg },
  avatarFallback: {
    backgroundColor: Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: AccentText, fontSize: 15, lineHeight: 19, fontWeight: '700' },
  body: { flex: 1, gap: Spacing.half },
  message: { lineHeight: 19 },
  dot: { width: 9, height: 9, borderRadius: 5 },
});
