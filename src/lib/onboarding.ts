import AsyncStorage from '@react-native-async-storage/async-storage';

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
