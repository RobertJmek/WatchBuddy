import { useCallback, useEffect, useRef, useState } from 'react';

import type { PendingUndo } from '@/lib/notification-undos';

/** How long an Undo strip stays before the dismissal is just… done. */
const UNDO_MS = 4000;

/**
 * Every row of a swipe-to-dismiss list currently offering an Undo, in the order
 * they were swiped. One per dismissal, not one in total: swiping three rows
 * away leaves three ways back, because each dismissal is its own committed act.
 * Where each strip stands is `interleaveUndos`' job.
 *
 * `id` must be stable (a module-level function), or the callbacks change on
 * every render.
 */
export function usePendingUndos<T>(id: (t: T) => string) {
  const [undos, setUndos] = useState<PendingUndo<T>[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const forget = useCallback(
    (item: T) => {
      const key = id(item);
      const timer = timers.current.get(key);
      if (timer) clearTimeout(timer);
      timers.current.delete(key);
      setUndos((prev) => prev.filter((u) => id(u.item) !== key));
    },
    [id],
  );

  const offer = useCallback(
    (item: T, beforeId: string | null) => {
      setUndos((prev) => [...prev, { item, beforeId }]);
      timers.current.set(
        id(item),
        setTimeout(() => forget(item), UNDO_MS),
      );
    },
    [id, forget],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  return { undos, offer, forget };
}
