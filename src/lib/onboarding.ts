import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

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
