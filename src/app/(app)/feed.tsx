import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { DismissedNotice } from '@/components/dismissed-notice';
import { EmptyState } from '@/components/empty-state';
import { FeedRow } from '@/components/feed-row';
import { NotificationRow } from '@/components/notification-row';
import { SwipeToDismissRow } from '@/components/swipe-to-dismiss-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopSafeAreaView } from '@/components/top-safe-area';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { getFeed, markFeedSeen } from '@/lib/feed';
import { hapticFailure, hapticSuccess, hapticUndo } from '@/lib/haptics';
import {
  dismissNotification,
  getNotifications,
  markAllRead,
  subscribeToNotifications,
  undismissNotification,
  type NotificationItem,
} from '@/lib/notifications';
import { getFollowCounts } from '@/lib/social';

/** How long an Undo strip stays before the dismissal is just… done. */
const UNDO_MS = 4000;

/** The row below `n`, which is what an Undo strip anchors itself above. */
function nextId(list: NotificationItem[], n: NotificationItem): string | null {
  const i = list.indexOf(n);
  return i >= 0 && i + 1 < list.length ? list[i + 1].id : null;
}

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

  // Every row currently offering an Undo, in the order they were swiped. One per
  // dismissal, not one in total: swiping three notifications away leaves three
  // ways back, because each dismissal is its own committed act.
  //
  // A strip is anchored to `beforeId` — the id of the row it sat *above* — rather
  // than to an index. Indices shift as neighbours are dismissed and as background
  // refetches land; an anchor doesn't. A strip whose anchor is gone falls to the
  // bottom of the block rather than to a wrong position.
  const [undos, setUndos] = useState<
    { item: NotificationItem; beforeId: string | null }[]
  >([]);
  const undoTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const forgetUndo = useCallback((id: string) => {
    const timer = undoTimers.current.get(id);
    if (timer) clearTimeout(timer);
    undoTimers.current.delete(id);
    setUndos((prev) => prev.filter((u) => u.item.id !== id));
  }, []);

  useEffect(() => {
    const timers = undoTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  const onDismiss = useCallback(
    async (item: NotificationItem, beforeId: string | null) => {
      // Optimistic: the buzz and the disappearance happen on the gesture, not
      // when Supabase answers. `hapticUndo` is the taking-something-back verb.
      hapticUndo();
      const previous =
        queryClient.getQueryData<NotificationItem[]>(['notifications']) ?? [];
      queryClient.setQueryData<NotificationItem[]>(['notifications'], (old) =>
        (old ?? []).filter((n) => n.id !== item.id),
      );
      setUndos((prev) => [...prev, { item, beforeId }]);
      undoTimers.current.set(
        item.id,
        setTimeout(() => forgetUndo(item.id), UNDO_MS),
      );

      try {
        await dismissNotification(item.id);
        // Dismissal writes read_at too, so the badge has to be re-counted.
        queryClient.invalidateQueries({ queryKey: ['notifUnread'] });
      } catch {
        queryClient.setQueryData(['notifications'], previous);
        forgetUndo(item.id);
        hapticFailure();
      }
    },
    [queryClient, forgetUndo],
  );

  const onUndo = useCallback(
    async (item: NotificationItem) => {
      hapticSuccess();
      forgetUndo(item.id);
      // Put the row back **before** the write, the mirror image of the dismissal.
      // It used to wait for a refetch to bring it back, which is why undoing
      // looked like it did nothing until you pulled to refresh. Re-sorted the way
      // the server sorts, so the row lands where it belongs rather than on top.
      queryClient.setQueryData<NotificationItem[]>(['notifications'], (old) => {
        const rest = old ?? [];
        if (rest.some((n) => n.id === item.id)) return rest;
        return [...rest, item].sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
        );
      });
      try {
        await undismissNotification(item.id);
      } catch {
        hapticFailure();
      }
      // Reconcile either way: on success this is a no-op, on failure it takes the
      // row back off the list.
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifUnread'] });
    },
    [forgetUndo, queryClient],
  );

  // The pinned block: each notification as a swipeable row, with every pending
  // Undo strip standing where its row used to be.
  const notificationRows: React.ReactNode[] = [];
  const placed = new Set<string>();
  for (const n of notifications) {
    for (const u of undos) {
      if (u.beforeId === n.id) {
        placed.add(u.item.id);
        notificationRows.push(
          <DismissedNotice key={`undo-${u.item.id}`} onUndo={() => onUndo(u.item)} />,
        );
      }
    }
    notificationRows.push(
      <SwipeToDismissRow key={n.id} onDismiss={() => onDismiss(n, nextId(notifications, n))}>
        <NotificationRow item={n} />
      </SwipeToDismissRow>,
    );
  }
  // Strips for rows that were last, or whose anchor has since gone.
  for (const u of undos) {
    if (!placed.has(u.item.id)) {
      notificationRows.push(
        <DismissedNotice key={`undo-${u.item.id}`} onUndo={() => onUndo(u.item)} />,
      );
    }
  }

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
            notificationRows.length > 0 ? (
              <View style={styles.notifications}>{notificationRows}</View>
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
            // Only speak to emptiness when the pinned block is empty too — the
            // Undo strip counts, or dismissing the last notification would flash
            // "your feed is empty" next to the way back from it.
            isLoading || notificationRows.length > 0 ? null : followsNobody ? (
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
