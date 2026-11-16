import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth-context';

/**
 * Activity rows the viewer swiped away, kept on this device per account
 * (Robert's call, 2026-11-16: no table, no migration). It does not sync and a
 * reinstall forgets it.
 *
 * A feed row has no id of its own: `feed.ts` builds its key from
 * `type:actor:entity:created_at` (ADR 0014). New activity on the same thing (one
 * more episode of a binge) changes the key, so the row comes back, the way a
 * dismissed notification returns with new activity.
 */

// ponytail: only the newest 500 keys are kept. An older one matters only while
// its row is still within reach of the feed's infinite scroll.
const MAX_KEYS = 500;

const storageKey = (uid: string) => `wb:feed-dismissed:${uid}`;

function parse(raw: string | null): string[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function useFeedDismissals() {
  const uid = useAuth().session?.user.id ?? null;
  const [loaded, setLoaded] = useState<{ uid: string | null; keys: string[] }>({
    uid: null,
    keys: [],
  });

  useEffect(() => {
    if (!uid) return;
    let live = true;
    AsyncStorage.getItem(storageKey(uid)).then(
      (raw) => live && setLoaded({ uid, keys: parse(raw) }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [uid]);

  // Another account's keys never apply, even for the moment before this
  // account's have loaded.
  const keys = loaded.uid === uid ? loaded.keys : [];

  const update = useCallback(
    (change: (keys: string[]) => string[]) => {
      if (!uid) return;
      setLoaded((prev) => {
        const next = change(prev.uid === uid ? prev.keys : []).slice(-MAX_KEYS);
        AsyncStorage.setItem(storageKey(uid), JSON.stringify(next)).catch(() => {});
        return { uid, keys: next };
      });
    },
    [uid],
  );

  const dismiss = useCallback(
    (key: string) => update((keys) => [...keys.filter((k) => k !== key), key]),
    [update],
  );
  const restore = useCallback(
    (key: string) => update((keys) => keys.filter((k) => k !== key)),
    [update],
  );

  return { dismissed: new Set(keys), dismiss, restore };
}
