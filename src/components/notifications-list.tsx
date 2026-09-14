import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  type RefreshControlProps,
} from 'react-native';

import { DismissedNotice } from '@/components/dismissed-notice';
import { EmptyState } from '@/components/empty-state';
import { NotificationRow } from '@/components/notification-row';
import { SwipeToDismissRow } from '@/components/swipe-to-dismiss-row';
import { Spacing } from '@/constants/theme';
import { hapticFailure, hapticSuccess, hapticUndo } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import {
  interleaveUndos,
  nextId,
  type PendingUndo,
} from '@/lib/notification-undos';
import {
  dismissNotification,
  undismissNotification,
  type NotificationItem,
} from '@/lib/notifications';

/** How long an Undo strip stays before the dismissal is just… done. */
const UNDO_MS = 4000;

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
 * Stays mounted while hidden so its scroll offset survives a trip to Activity;
 * `display: none` also makes the swipe gestures inside it untouchable, so a
 * horizontal drag on an Activity row can never reach them.
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

  // Every row currently offering an Undo, in the order they were swiped. One per
  // dismissal, not one in total: swiping three notifications away leaves three
  // ways back, because each dismissal is its own committed act. Where each strip
  // stands is `interleaveUndos`' job.
  const [undos, setUndos] = useState<PendingUndo[]>([]);
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
        queryClient.getQueryData<NotificationItem[]>(keys.notifications()) ?? [];
      queryClient.setQueryData<NotificationItem[]>(keys.notifications(), (old) =>
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
        queryClient.invalidateQueries({ queryKey: keys.notifUnread() });
      } catch {
        queryClient.setQueryData(keys.notifications(), previous);
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

  const rows = interleaveUndos(notifications, undos);

  return (
    <View style={[styles.wrap, !visible && styles.hidden]}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item: row }) =>
          row.kind === 'undo' ? (
            <DismissedNotice onUndo={() => onUndo(row.item)} />
          ) : (
            <SwipeToDismissRow
              onDismiss={() => onDismiss(row.item, nextId(notifications, row.item))}>
              <NotificationRow
                item={row.item}
                onDismiss={() => onDismiss(row.item, nextId(notifications, row.item))}
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
  hidden: { display: 'none' },
  list: { gap: Spacing.two, paddingVertical: Spacing.two, flexGrow: 1 },
});
