import { type NotificationItem } from '@/lib/notifications';

/**
 * The Notifications segment's row order, as a pure function — the one piece of
 * real logic behind the swipe-to-dismiss list (`components/notifications-list`).
 *
 * Kept out of the component and free of any runtime import (the type above is
 * erased) so it can be exercised on its own, the same reason `rpc-shape.ts`
 * exists. Getting it wrong is invisible to `tsc`: every wrong order is still a
 * list of rows.
 */

/** A dismissal still offering a way back. */
export type PendingUndo = {
  item: NotificationItem;
  /**
   * The id of the row this one sat *above* when it was dismissed — the anchor
   * the Undo strip stands on. An index would not survive the neighbours being
   * dismissed or a background refetch landing; an anchor does. `null` means the
   * row was last.
   */
  beforeId: string | null;
};

/** A notification row, or the Undo strip standing where one used to be. */
export type UndoListRow = {
  key: string;
  kind: 'row' | 'undo';
  item: NotificationItem;
};

/** The row below `n`, which is what an Undo strip anchors itself above. */
export function nextId(
  list: NotificationItem[],
  n: NotificationItem,
): string | null {
  const i = list.indexOf(n);
  return i >= 0 && i + 1 < list.length ? list[i + 1].id : null;
}

/**
 * The list as rendered: every notification, with each pending Undo strip in the
 * place its row used to hold. A strip whose anchor has since gone — the row
 * below it was dismissed too, or aged out — falls to the bottom rather than to a
 * wrong position.
 */
export function interleaveUndos(
  notifications: NotificationItem[],
  undos: PendingUndo[],
): UndoListRow[] {
  const rows: UndoListRow[] = [];
  const placed = new Set<string>();
  for (const n of notifications) {
    for (const u of undos) {
      if (u.beforeId === n.id) {
        placed.add(u.item.id);
        rows.push({ key: `undo-${u.item.id}`, kind: 'undo', item: u.item });
      }
    }
    rows.push({ key: n.id, kind: 'row', item: n });
  }
  for (const u of undos) {
    if (!placed.has(u.item.id)) {
      rows.push({ key: `undo-${u.item.id}`, kind: 'undo', item: u.item });
    }
  }
  return rows;
}
