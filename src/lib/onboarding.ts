import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

/**
 * Tracks whether a user has been through the first-run onboarding screen
 * (the one that suggests setting a username + avatar so friends can find them).
 *
 * Keyed per user id — not global — so a second account signing in on the same
 * device gets its own onboarding, and so signing out never re-triggers it for
 * an account that already dismissed it.
 */
const key = (uid: string) => `wb:onboarding-seen:${uid}`;

export async function hasSeenOnboarding(uid: string): Promise<boolean> {
  return (await AsyncStorage.getItem(key(uid))) !== null;
}

export async function markOnboardingSeen(uid: string): Promise<void> {
  await AsyncStorage.setItem(key(uid), '1');
}

/**
 * Whether this install has shown the welcome screen, which comes before
 * sign-in on the first launch (ADR 0028). It is per device, not per user: it
 * describes the install. Deleting the app clears it, so a reinstall gets the
 * welcome screen again. `null` until storage has answered.
 */
const WELCOME_KEY = 'wb:welcome-seen';
let welcomeSeen: boolean | null = null;
const listeners = new Set<() => void>();
const setWelcome = (v: boolean) => {
  welcomeSeen = v;
  listeners.forEach((l) => l());
};
// A storage failure must not hold the app on a blank screen: treat it as seen.
AsyncStorage.getItem(WELCOME_KEY).then(
  (v) => welcomeSeen ?? setWelcome(v !== null),
  () => welcomeSeen ?? setWelcome(true),
);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useWelcomeSeen(): boolean | null {
  return useSyncExternalStore(subscribe, () => welcomeSeen);
}

export function markWelcomeSeen(): void {
  if (welcomeSeen === true) return;
  setWelcome(true);
  AsyncStorage.setItem(WELCOME_KEY, '1').catch(() => {});
}

/**
 * One-time tips for gestures nothing on screen gives away (ADR 0034). A tip
 * shows in the place its gesture works until the user does the gesture once or
 * taps "Got it", then never again on this install. Per device, like the
 * welcome flag: it describes what this install has shown.
 */
export type TipId = 'hold-menu' | 'season-swipe' | 'notification-dismiss' | 'push-card';

const tipKey = (id: TipId) => `wb:tip-done:${id}`;
/** Absent = storage hasn't answered yet, and the tip stays hidden. */
const tipDone = new Map<TipId, boolean>();
const setTip = (id: TipId, done: boolean) => {
  tipDone.set(id, done);
  listeners.forEach((l) => l());
};

/** True while the tip should be on screen. */
export function useTipVisible(id: TipId): boolean {
  const done = useSyncExternalStore(subscribe, () => tipDone.get(id));
  useEffect(() => {
    if (tipDone.has(id)) return;
    // A gesture can finish before storage answers; it wins. A storage failure
    // hides the tip rather than showing it on every launch.
    AsyncStorage.getItem(tipKey(id)).then(
      (v) => tipDone.has(id) || setTip(id, v !== null),
      () => tipDone.has(id) || setTip(id, true),
    );
  }, [id]);
  return done === false;
}

/** The gesture was done, or the tip dismissed. Safe to call every time. */
export function markTipDone(id: TipId): void {
  if (tipDone.get(id) === true) return;
  setTip(id, true);
  AsyncStorage.setItem(tipKey(id), '1').catch(() => {});
}
