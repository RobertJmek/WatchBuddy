import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  type RefreshControlProps,
} from 'react-native';

import { DismissedNotice } from '@/components/dismissed-notice';
import { EmptyState } from '@/components/empty-state';
import { NotificationRow } from '@/components/notification-row';
import { PushCard, usePushCardOpen } from '@/components/push-card';
import { SwipeToDismissRow } from '@/components/swipe-to-dismiss-row';
import { Tip } from '@/components/tip';
import { Spacing } from '@/constants/theme';
import { usePendingUndos } from '@/hooks/use-pending-undos';
import { hapticFailure, hapticSuccess, hapticUndo } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import { markTipDone } from '@/lib/onboarding';
import { interleaveUndos, nextId } from '@/lib/notification-undos';
import {
  dismissNotification,
  undismissNotification,
  type NotificationItem,
} from '@/lib/notifications';

const notificationId = (n: NotificationItem) => n.id;

/**
 * The **Notifications** segment of the Feed tab: things that happened *to you*
 * — likes and replies on your reviews, and new followers — each swipeable away
 * with an Undo strip in its place.
 *
 * It owns the whole dismiss/undo machinery, which used to sit in `feed.tsx` and
 * render into that screen's `ListHeaderComponent`. Splitting the tab into two
 * segments (ADR 0021) made the pinned block a list of its own, and the state
 * that belongs to it came along: the screen above now only decides which of the
 * two lists is visible.
 *
 * Stays mounted while hidden so its scroll offset survives a trip to Activity.
 * Hidden means transparent and untouchable, so a horizontal drag on an
 * Activity row can never reach the swipe gestures in here.
 */
export function NotificationsList({
  notifications,
  refreshControl,
  visible,
}: {
  notifications: NotificationItem[];
  refreshControl: React.ReactElement<RefreshControlProps>;
  visible: boolean;
}) {
  const queryClient = useQueryClient();

  const { undos, offer, forget: forgetUndo } = usePendingUndos(notificationId);

  const onDismiss = useCallback(
    async (item: NotificationItem, beforeId: string | null) => {
      // Optimistic: the buzz and the disappearance happen on the gesture, not
      // when Supabase answers. `hapticUndo` is the taking-something-back verb.
      hapticUndo();
      markTipDone('notification-dismiss');
      const previous =
        queryClient.getQueryData<NotificationItem[]>(keys.notifications()) ?? [];
      queryClient.setQueryData<NotificationItem[]>(keys.notifications(), (old) =>
        (old ?? []).filter((n) => n.id !== item.id),
      );
      offer(item, beforeId);

      try {
        await dismissNotification(item.id);
        // Dismissal writes read_at too, so the badge has to be re-counted.
        queryClient.invalidateQueries({ queryKey: keys.notifUnread() });
      } catch {
        queryClient.setQueryData(keys.notifications(), previous);
        forgetUndo(item);
        hapticFailure();
      }
    },
    [queryClient, offer, forgetUndo],
  );

  const onUndo = useCallback(
    async (item: NotificationItem) => {
      hapticSuccess();
      forgetUndo(item);
      // Put the row back **before** the write, the mirror image of the dismissal.
      // It used to wait for a refetch to bring it back, which is why undoing
      // looked like it did nothing until you pulled to refresh. Re-sorted the way
      // the server sorts, so the row lands where it belongs rather than on top.
      queryClient.setQueryData<NotificationItem[]>(keys.notifications(), (old) => {
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
      queryClient.invalidateQueries({ queryKey: keys.notifications() });
      queryClient.invalidateQueries({ queryKey: keys.notifUnread() });
    },
    [forgetUndo, queryClient],
  );

  const rows = interleaveUndos(notifications, undos, notificationId);
  const pushCardOpen = usePushCardOpen();

  return (
    <View
      style={[styles.wrap, !visible && styles.hidden]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item: row }) =>
          row.kind === 'undo' ? (
            <DismissedNotice onUndo={() => onUndo(row.item)} />
          ) : (
            <SwipeToDismissRow
              onDismiss={() =>
                onDismiss(row.item, nextId(notifications, row.item, notificationId))
              }>
              <NotificationRow
                item={row.item}
                onDismiss={() =>
                  onDismiss(row.item, nextId(notifications, row.item, notificationId))
                }
              />
            </SwipeToDismissRow>
          )
        }
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
        // `rows` carries the Undo strips as well, so an empty list really is
        // empty — dismissing the last notification shows the way back from it
        // rather than "no notifications" next to it.
        // One ask at a time: the push card first (ADR 0039), the gesture tip after.
        ListHeaderComponent={
          <>
            <PushCard style={styles.tip} />
            {notifications.length > 0 && !pushCardOpen && (
              <Tip
                id="notification-dismiss"
                text="Swipe a notification right to dismiss it."
                style={styles.tip}
              />
            )}
          </>
        }
        ListEmptyComponent={
          <EmptyState
            icon="bell"
            title="No notifications"
            hint="Likes, replies and new followers show up here."
          />
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
  tip: { marginHorizontal: Spacing.four },
});
