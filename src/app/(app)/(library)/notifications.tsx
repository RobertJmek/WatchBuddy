import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { RowSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  getNotifications,
  markAllRead,
  type NotificationItem,
} from '@/lib/notifications';

function timeAgo(iso: string) {
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

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

export default function NotificationsScreen() {
  const c = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
  });

  // Opening the screen consumes the unread state.
  useEffect(() => {
    markAllRead()
      .then(() =>
        queryClient.invalidateQueries({ queryKey: ['notifUnread'] }),
      )
      .catch(() => {});
  }, [queryClient]);

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Notifications' }} />
      {isLoading ? (
        <View style={{ padding: Spacing.three, gap: Spacing.two }}>
          {[0, 1, 2, 3].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="bell"
              title="Nothing yet"
              hint="Likes and replies to your reviews land here."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              style={[
                styles.row,
                { backgroundColor: c.backgroundElement },
                item.unread && { backgroundColor: c.backgroundSelected },
              ]}
              // Stay inside the Library stack so the tab bar remains visible on
              // the thread (one tap to any tab, no double Back) — see ADR 0005.
              onPress={() =>
                router.push({
                  pathname: '/thread/[ratingId]',
                  params: { ratingId: item.ratingId },
                })
              }>
              {/* Avatar goes to the actor's profile; the row goes to the thread. */}
              <Pressable
                hitSlop={6}
                onPress={() =>
                  router.push({
                    pathname: '/user/[id]',
                    params: { id: item.actorId },
                  })
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
                  {timeAgo(item.created_at)}
                </ThemedText>
              </View>
              {item.unread && (
                <View style={[styles.dot, { backgroundColor: Accent }]} />
              )}
            </Pressable>
          )}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.two },
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
