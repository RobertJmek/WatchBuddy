import { useRouter } from 'expo-router';
import {
  FlatList,
  StyleSheet,
  View,
  type RefreshControlProps,
} from 'react-native';

import { Button } from '@/components/button';
import { DismissedNotice } from '@/components/dismissed-notice';
import { EmptyState } from '@/components/empty-state';
import { FeedRow } from '@/components/feed-row';
import { SwipeToDismissRow } from '@/components/swipe-to-dismiss-row';
import { Spacing } from '@/constants/theme';
import { usePendingUndos } from '@/hooks/use-pending-undos';
import { type FeedItem } from '@/lib/feed';
import { useFeedDismissals } from '@/lib/feed-dismissals';
import { hapticSuccess, hapticUndo } from '@/lib/haptics';
import { interleaveUndos, nextId } from '@/lib/notification-undos';

const feedKey = (item: FeedItem) => item.key;

/**
 * The **Activity** segment of the Feed tab: what the people you follow have
 * been doing. A dumb list — the screen above owns the infinite query, the
 * refresh control and the 24h seen-watermark (ADR 0006); this only renders
 * rows, asks for the next page, and says the right thing when there is nothing.
 *
 * `onEndReached` lives here and nowhere else, so the short Notifications list
 * can never trigger a `get_feed` page it has no use for.
 *
 * Rows swipe away like notifications, with the same Undo strip, but the
 * dismissal lives on this device only (`lib/feed-dismissals.ts`).
 *
 * Stays mounted while hidden (transparent, untouchable) so its scroll position
 * and the pages already loaded survive a trip to Notifications and back.
 */
export function ActivityList({
  items,
  isLoading,
  followsNobody,
  onEndReached,
  refreshControl,
  visible,
}: {
  items: FeedItem[];
  /** Suppresses the empty state on the very first load, before anything landed. */
  isLoading: boolean;
  /** Distinguishes "follow someone" from "your friends have been quiet". */
  followsNobody: boolean;
  onEndReached: () => void;
  refreshControl: React.ReactElement<RefreshControlProps>;
  visible: boolean;
}) {
  const router = useRouter();
  const { dismissed, dismiss, restore } = useFeedDismissals();
  const { undos, offer, forget } = usePendingUndos(feedKey);
  const shown = items.filter((item) => !dismissed.has(item.key));

  const onDismiss = (item: FeedItem) => {
    hapticUndo();
    offer(item, nextId(shown, item, feedKey));
    dismiss(item.key);
  };
  const onUndo = (item: FeedItem) => {
    hapticSuccess();
    forget(item);
    restore(item.key);
  };

  return (
    <View
      style={[styles.wrap, !visible && styles.hidden]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}>
      <FlatList
        data={interleaveUndos(shown, undos, feedKey)}
        keyExtractor={(row) => row.key}
        renderItem={({ item: row }) =>
          row.kind === 'undo' ? (
            <DismissedNotice what="activity" onUndo={() => onUndo(row.item)} />
          ) : (
            <SwipeToDismissRow onDismiss={() => onDismiss(row.item)}>
              <FeedRow item={row.item} onDismiss={() => onDismiss(row.item)} />
            </SwipeToDismissRow>
          )
        }
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.5}
        onEndReached={onEndReached}
        refreshControl={refreshControl}
        ListEmptyComponent={
          isLoading ? null : followsNobody ? (
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  // Not `display: none`: on iOS that keeps the rows out of the native view tree,
  // and a gesture handler (a row's swipe, a poster's hold) that can't find its
  // view within 2.5 s of mounting never attaches (#148).
  hidden: { ...StyleSheet.absoluteFill, opacity: 0, pointerEvents: 'none' },
  list: { gap: Spacing.two, paddingVertical: Spacing.two, flexGrow: 1 },
  emptyWrap: { gap: Spacing.four, paddingHorizontal: Spacing.four },
});
