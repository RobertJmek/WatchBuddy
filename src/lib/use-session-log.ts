import { useCallback, useRef, useState } from 'react';

import { hapticFailure, hapticSuccess, hapticUndo } from '@/lib/haptics';

/** One swipe-logged row, remembered for the session (ADR 0011). */
export type SessionEntry<D> = {
  /** What the write returned (the rows it inserted); null while pending. */
  data: D | null;
  /** True while the optimistic ✓ is shown but the DB write hasn't landed yet. */
  pending: boolean;
};

/**
 * Swipe-to-log's session-scoped undo, shared by Search and the title screen's
 * season rows: a log shows the ✓ at once and writes in the background; an undo
 * reverses exactly what that log wrote — via `reverse` — even while the write
 * is still in flight. A write that throws rolls the ✓ back.
 */
export function useSessionLog<D>(reverse: (data: D) => Promise<void>) {
  const [logged, setLogged] = useState<Map<string, SessionEntry<D>>>(new Map());
  // Cancel tokens for in-flight logs, so an undo tapped *before* the DB write
  // finishes can cancel it — the write, once done, rolls itself back.
  const inflight = useRef(new Map<string, { cancelled: boolean }>());
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

  const drop = useCallback((key: string) => {
    setLogged((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const log = useCallback(function log(key: string, write: () => Promise<D>) {
    if (loggedRef.current.has(key)) return;
    // Optimistic: show the ✓ instantly; the DB write runs in the background.
    setLogged((prev) => new Map(prev).set(key, { data: null, pending: true }));
    hapticSuccess();
    const token = { cancelled: false };
    inflight.current.set(key, token);
    // Log → undo → log again can put a second run's token under the same key
    // before this one settles; deleting it then would let the second run's
    // undo miss its write. Only ever remove our own.
    const dropToken = () => {
      if (inflight.current.get(key) === token) inflight.current.delete(key);
    };
    void (async () => {
      try {
        const data = await write();
        dropToken();
        if (token.cancelled) {
          // Undone while the write was in flight → roll it straight back.
          await reverseRef.current(data);
          return;
        }
        // Swap the pending entry for the resolved one (with real ids for undo).
        setLogged((prev) =>
          prev.has(key) ? new Map(prev).set(key, { data, pending: false }) : prev,
        );
      } catch {
        dropToken();
        drop(key);
        hapticFailure();
      }
    })();
  }, [drop]);

  const undo = useCallback(function undo(key: string) {
    const entry = loggedRef.current.get(key);
    if (!entry) return;
    // Optimistic: drop the ✓ instantly.
    drop(key);
    hapticUndo();
    const token = inflight.current.get(key);
    if (token) {
      // Still writing — cancel; the log's completion handler rolls it back.
      token.cancelled = true;
      return;
    }
    // Resolved entry → delete its rows now.
    if (entry.data !== null) void reverseRef.current(entry.data).catch(() => {});
  }, [drop]);

  return { logged, log, undo };
}
