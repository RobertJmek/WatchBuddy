import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet } from 'react-native';

import { ActivityList } from '@/components/activity-list';
import { NotificationsList } from '@/components/notifications-list';
import { SegmentedControl, type Segment } from '@/components/segmented-control';
import { SwipeNav } from '@/components/swipe-nav';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopSafeAreaView } from '@/components/top-safe-area';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { getFeed, markFeedSeen } from '@/lib/feed';
import { hapticToggle } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import {
  getNotifications,
  markAllRead,
  subscribeToNotifications,
} from '@/lib/notifications';
import { getFollowCounts } from '@/lib/social';
import { useTabPager } from '@/lib/tab-pager';

type SegmentKey = 'activity' | 'notifications';

/**
 * The Feed tab, in two segments: **Activity** (what the people you follow are
 * doing) and **Notifications** (what happened to you). They used to be one
 * scroll surface with notifications pinned on top, which made a row that needs
 * you look exactly like a row that is only news — and made the tab badge
 * ambiguous, since it cleared on mere tab focus. See ADR 0021, amending 0006.
 *
 * Both lists stay **mounted** behind the segmented control, hidden with
 * `display: none` rather than unmounted, so each keeps its own scroll offset and
 * its loaded pages. A swipe switches them too, but through the same `setSegment`
 * — not a pager. A nested pager would take every touch-down away from the
 * swipe-to-dismiss rows on Android, and this way a notification row (which
 * activates sooner) still wins its rightward drag over the segment swipe.
 * Only the direction that leads somewhere is enabled, so the other one falls
 * through to the tab pager: swiping left on Notifications reaches Library.
 *
 * This screen owns the data (both queries, the refresh control, the realtime
 * subscription, the seen watermark) and which segment is showing; the two lists
 * own their rendering, and Notifications owns its dismiss/undo state.
 */
export default function FeedScreen() {
  const c = useTheme();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const myId = session?.user.id;

  const [segment, setSegment] = useState<SegmentKey>('activity');
  // The same feedback as a tap on the control; only a real change gets here.
  const select = useCallback((key: SegmentKey) => {
    hapticToggle(true);
    setSegment(key);
  }, []);
  const tabPager = useTabPager();

  const {
    data,
    isLoading,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: keys.feed(),
    queryFn: ({ pageParam }) => getFeed({ before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  // Personal notifications (likes/replies/follows), the second segment.
  const { data: notifications = [], refetch: refetchNotifications } = useQuery({
    queryKey: keys.notifications(),
    queryFn: getNotifications,
  });

  // Whether the viewer follows anyone — distinguishes "follow someone" from
  // "your friends have been quiet" in the empty state.
  const { data: counts } = useQuery({
    queryKey: keys.followCounts(myId),
    queryFn: () => getFollowCounts(myId!),
    enabled: !!myId,
  });

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const followsNobody = (counts?.following ?? 0) === 0;

  const [refreshing, setRefreshing] = useState(false);
  // Pull-to-refresh refreshes the tab, not the segment: both sources, whichever
  // list the gesture happened on.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchNotifications()]);
    setRefreshing(false);
  }, [refetch, refetchNotifications]);

  // One descriptor, two lists: React mounts a separate control in each.
  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={c.tint}
      colors={[c.tint]}
    />
  );

  // Live-refresh the notifications + tab badge as activity lands.
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    return subscribeToNotifications(uid, () => {
      queryClient.invalidateQueries({ queryKey: keys.notifUnread() });
      queryClient.invalidateQueries({ queryKey: keys.notifications() });
    });
  }, [session?.user.id, queryClient]);

  useFocusEffect(
    useCallback(() => {
      // On focus: refresh everything. Marking read is *not* here any more — see
      // the effect below.
      refetch();
      refetchNotifications();
      // On blur: advance the seen watermark so what we just looked at ages out
      // (~24h) rather than mutating the list while we're reading it.
      return () => {
        markFeedSeen().catch(() => {});
      };
    }, [refetch, refetchNotifications]),
  );

  // Reading the notifications is what marks them read — not arriving on the
  // tab. The badge used to clear the moment the Feed took focus, whether or not
  // the notifications were ever looked at, which is most of why it stopped
  // meaning anything. Rows keep their unread highlight until the next refetch,
  // as before.
  const isFocused = useIsFocused();
  useEffect(() => {
    if (!isFocused || segment !== 'notifications') return;
    markAllRead()
      .then(() => queryClient.invalidateQueries({ queryKey: keys.notifUnread() }))
      .catch(() => {});
  }, [isFocused, segment, queryClient]);

  // From the list already loaded, not a third query. The tab badge counts the
  // same thing from `getUnreadCount`; both are invalidated on the same events,
  // so in practice they agree.
  const unread = notifications.filter((n) => n.unread).length;
  const segments: Segment<SegmentKey>[] = [
    { key: 'activity', label: 'Activity' },
    {
      key: 'notifications',
      label: 'Notifications',
      count: unread,
      countLabel: `${unread} unread`,
    },
  ];

  return (
    <ThemedView style={styles.container}>
      <TopSafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.heading}>
          Feed
        </ThemedText>

        <SegmentedControl
          segments={segments}
          value={segment}
          onChange={setSegment}
        />

        <SwipeNav
          // Under the pager's 16dp paging slop, above a row swipe's 10.
          activateDistance={12}
          blocks={tabPager?.native}
          onSwipeLeft={segment === 'activity' ? () => select('notifications') : undefined}
          onSwipeRight={
            segment === 'notifications' ? () => select('activity') : undefined
          }>
          <ActivityList
            items={items}
            isLoading={isLoading}
            followsNobody={followsNobody}
            onEndReached={() => {
              if (hasNextPage && !isFetchingNextPage) fetchNextPage();
            }}
            refreshControl={refreshControl}
            visible={segment === 'activity'}
          />
          <NotificationsList
            notifications={notifications}
            refreshControl={refreshControl}
            visible={segment === 'notifications'}
          />
        </SwipeNav>
      </TopSafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  heading: { marginTop: Spacing.three, marginBottom: Spacing.two },
});
