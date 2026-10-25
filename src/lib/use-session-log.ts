import { useCallback, useRef, useState } from 'react';

import { hapticFailure, hapticSuccess, hapticUndo } from '@/lib/haptics';

/** One swipe-log, remembered for the session (ADR 0011). */
export type SessionEntry<D> = {
  /** What the write returned (the rows it inserted); null while pending. */
  data: D | null;
  /** True while the optimistic ✓ is shown but the DB write hasn't landed yet. */
  pending: boolean;
  /** Set by an undo that lands before the write does; the write then rolls itself back. */
  cancelled: boolean;
};

/**
 * Swipe-to-log's session-scoped undo, shared by Search and the title screen's
 * season rows: a log shows the ✓ at once and writes in the background; an undo
 * reverses exactly what one log wrote — via `reverse` — even while the write
 * is still in flight. A write that throws rolls its ✓ back.
 *
 * Each key holds a stack of logs, oldest first. Search allows one per row; the
 * season rows pass `repeat`, so every swipe adds another and undo pops the
 * latest.
 */
export function useSessionLog<D>(reverse: (data: D) => Promise<void>) {
  const [logged, setLogged] = useState<Map<string, SessionEntry<D>[]>>(new Map());
  // The two handlers below are handed to memoized rows, so they have to stay
  // referentially stable — which means they can't close over `logged`. They read
  // it through here instead. (Same mailbox pattern as `range-slider`.)
  const loggedRef = useRef(logged);
  // eslint-disable-next-line react-hooks/refs -- a mailbox, not render state
  loggedRef.current = logged;
  // `reverse` is usually an inline closure; read it the same way.
  const reverseRef = useRef(reverse);
  // eslint-disable-next-line react-hooks/refs -- a mailbox, not render state
  reverseRef.current = reverse;

  /** Rewrite one key's stack; an empty stack drops the key. */
  const update = useCallback(
    (key: string, fn: (stack: SessionEntry<D>[]) => SessionEntry<D>[]) => {
      setLogged((prev) => {
        const stack = fn(prev.get(key) ?? []);
        const next = new Map(prev);
        if (stack.length) next.set(key, stack);
        else next.delete(key);
        return next;
      });
    },
    [],
  );

  const log = useCallback(function log(
    key: string,
    write: () => Promise<D>,
    { repeat = false }: { repeat?: boolean } = {},
  ) {
    if (!repeat && loggedRef.current.has(key)) return;
    // Settled in place, not replaced: an undo reads this same object through
    // the mailbox, so it sees the write land even before the next render.
    const entry: SessionEntry<D> = { data: null, pending: true, cancelled: false };
    // Optimistic: show the ✓ instantly; the DB write runs in the background.
    update(key, (stack) => [...stack, entry]);
    hapticSuccess();
    void (async () => {
      try {
        const data = await write();
        if (entry.cancelled) {
          // Undone while the write was in flight → roll it straight back.
          await reverseRef.current(data);
          return;
        }
        // Fill in this log's entry (with real ids for undo).
        entry.data = data;
        entry.pending = false;
        update(key, (stack) => [...stack]);
      } catch {
        if (entry.cancelled) return; // already off the stack
        update(key, (stack) => stack.filter((e) => e !== entry));
        hapticFailure();
      }
    })();
  }, [update]);

  const undo = useCallback(function undo(key: string) {
    const entry = loggedRef.current.get(key)?.at(-1);
    if (!entry) return;
    // Optimistic: drop the latest ✓ instantly.
    update(key, (stack) => stack.filter((e) => e !== entry));
    hapticUndo();
    if (entry.pending) {
      // Still writing — cancel; the log's completion handler rolls it back.
      entry.cancelled = true;
      return;
    }
    if (entry.data !== null) void reverseRef.current(entry.data).catch(() => {});
  }, [update]);

  return { logged, log, undo };
}
