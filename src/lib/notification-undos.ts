/**
 * The row order of a swipe-to-dismiss list, as a pure function — the one piece
 * of real logic behind the Notifications and Activity segments
 * (`components/notifications-list`, `components/activity-list`). `id` says what
 * identifies a row: a notification's id, a feed item's synthesised key.
 *
 * Kept out of the components and free of any runtime import so it can be
 * exercised on its own, the same reason `rpc-shape.ts` exists. Getting it wrong
 * is invisible to `tsc`: every wrong order is still a list of rows.
 */

/** A dismissal still offering a way back. */
export type PendingUndo<T> = {
  item: T;
  /**
   * The id of the row this one sat *above* when it was dismissed — the anchor
   * the Undo strip stands on. An index would not survive the neighbours being
   * dismissed or a background refetch landing; an anchor does. `null` means the
   * row was last.
   */
  beforeId: string | null;
};

/** A row, or the Undo strip standing where one used to be. */
export type UndoListRow<T> = {
  key: string;
  kind: 'row' | 'undo';
  item: T;
};

/** The row below `n`, which is what an Undo strip anchors itself above. */
export function nextId<T>(list: T[], n: T, id: (t: T) => string): string | null {
  const i = list.indexOf(n);
  return i >= 0 && i + 1 < list.length ? id(list[i + 1]) : null;
}

/**
 * The list as rendered: every row, with each pending Undo strip in the place
 * its row used to hold. A strip whose anchor has since gone — the row below it
 * was dismissed too, or aged out — falls to the bottom rather than to a wrong
 * position.
 */
export function interleaveUndos<T>(
  items: T[],
  undos: PendingUndo<T>[],
  id: (t: T) => string,
): UndoListRow<T>[] {
  const rows: UndoListRow<T>[] = [];
  const placed = new Set<string>();
  for (const n of items) {
    for (const u of undos) {
      if (u.beforeId === id(n)) {
        placed.add(id(u.item));
        rows.push({ key: `undo-${id(u.item)}`, kind: 'undo', item: u.item });
      }
    }
    rows.push({ key: id(n), kind: 'row', item: n });
  }
  for (const u of undos) {
    if (!placed.has(id(u.item))) {
      rows.push({ key: `undo-${id(u.item)}`, kind: 'undo', item: u.item });
    }
  }
  return rows;
}
