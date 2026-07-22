import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { FeedRow } from '@/components/feed-row';
import { NotificationRow } from '@/components/notification-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopSafeAreaView } from '@/components/top-safe-area';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { getFeed, markFeedSeen } from '@/lib/feed';
import {
  getNotifications,
  markAllRead,
  subscribeToNotifications,
} from '@/lib/notifications';
import { getFollowCounts } from '@/lib/social';

export default function FeedScreen() {
  const c = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const myId = session?.user.id;

  const {
    data,
    isLoading,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => getFeed({ before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  // Personal notifications (likes/replies on my reviews), pinned atop the feed.
  const { data: notifications = [], refetch: refetchNotifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
  });

  // Whether the viewer follows anyone — distinguishes "follow someone" from
  // "your friends have been quiet" in the empty state.
  const { data: counts } = useQuery({
    queryKey: ['followCounts', myId],
    queryFn: () => getFollowCounts(myId!),
    enabled: !!myId,
  });

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchNotifications()]);
    setRefreshing(false);
  }, [refetch, refetchNotifications]);

  // Live-refresh the pinned notifications + tab badge as activity lands.
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    return subscribeToNotifications(uid, () => {
      queryClient.invalidateQueries({ queryKey: ['notifUnread'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
  }, [session?.user.id, queryClient]);

  useFocusEffect(
    useCallback(() => {
      // On focus: refresh everything and clear the unread badge (rows keep their
      // unread highlight until the next visit).
      refetch();
      refetchNotifications();
      markAllRead()
        .then(() =>
          queryClient.invalidateQueries({ queryKey: ['notifUnread'] }),
        )
        .catch(() => {});
      // On blur: advance the seen watermark so what we just looked at ages out
      // (~24h) rather than mutating the list while we're reading it.
      return () => {
        markFeedSeen().catch(() => {});
      };
    }, [refetch, refetchNotifications, queryClient]),
  );

  const followsNobody = (counts?.following ?? 0) === 0;

  return (
    <ThemedView style={styles.container}>
      <TopSafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.heading}>
          Feed
        </ThemedText>

        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => <FeedRow item={item} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          ListHeaderComponent={
            notifications.length > 0 ? (
              <View style={styles.notifications}>
                {notifications.map((n) => (
                  <NotificationRow key={n.id} item={n} />
                ))}
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={c.tint}
              colors={[c.tint]}
            />
          }
          ListEmptyComponent={
            // Only speak to emptiness when there are no notifications either.
            isLoading || notifications.length > 0 ? null : followsNobody ? (
              <View style={styles.emptyWrap}>
                <EmptyState
                  icon="person.2"
                  title="Your feed is empty"
                  hint="Follow friends to see what they watch and rate."
                />
                <Button
                  title="Find people"
                  variant="outline"
                  onPress={() => router.push('/explore')}
                />
              </View>
            ) : (
              <EmptyState
                icon="film"
                title="You're all caught up"
                hint="New activity from people you follow shows up here."
              />
            )
          }
        />
      </TopSafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  heading: { marginTop: Spacing.three, marginBottom: Spacing.two },
  list: { gap: Spacing.two, paddingVertical: Spacing.two, flexGrow: 1 },
  notifications: { gap: Spacing.two, marginBottom: Spacing.two },
  emptyWrap: { gap: Spacing.four, paddingHorizontal: Spacing.four },
});
