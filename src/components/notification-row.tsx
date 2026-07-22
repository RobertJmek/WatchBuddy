import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatEventTime } from '@/components/feed-row';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type NotificationItem } from '@/lib/notifications';

function copyFor(n: NotificationItem) {
  const where = n.title ? ` on ${n.title}` : '';
  if (n.type === 'like') {
    return n.likeCount > 1
      ? `and ${n.likeCount - 1} ${n.likeCount === 2 ? 'other' : 'others'} liked your review${where}`
      : `liked your review${where}`;
  }
  return n.replyToComment
    ? `replied to your comment${where}`
    : `replied to your review${where}`;
}

/**
 * A personal notification (a like/reply on the viewer's own review). Pinned at
 * the top of the Feed. The avatar taps to the actor's profile; the row taps to
 * the review thread (`/review/[ratingId]`, a root route that covers the tab bar,
 * consistent with the Feed's other review taps).
 */
export function NotificationRow({ item }: { item: NotificationItem }) {
  const c = useTheme();
  const router = useRouter();
  return (
    <Pressable
      style={[
        styles.row,
        { backgroundColor: c.backgroundElement },
        item.unread && { backgroundColor: c.backgroundSelected },
      ]}
      onPress={() =>
        router.push({
          pathname: '/review/[ratingId]',
          params: { ratingId: item.ratingId },
        })
      }>
      <Pressable
        hitSlop={6}
        onPress={() =>
          router.push({ pathname: '/user/[id]', params: { id: item.actorId } })
        }>
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
