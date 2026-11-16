import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { deleteMine, selectMine, updateMine } from '@/lib/viewer';

/**
 * Push notifications (ADR 0039). The server decides what to send: every row
 * the notification triggers write goes out as a push (migration 0029). This
 * module only asks for permission, hands the server this phone's token, keeps
 * the icon badge in step with the unread count and opens what a tap points at.
 */

/**
 * The `robertjmk` EAS project, the account the EAS CLI and the iOS builds use.
 * A token belongs to the project that holds the APNs/FCM credentials, and
 * app.json names the other account's project (`robertjmek`, whose build quota is
 * spent), so the id is fixed here rather than read from config.
 */
const PROJECT_ID = 'cc64939c-eda6-46be-96fc-cd78843362f1';

export const pushSupported = Platform.OS === 'ios' || Platform.OS === 'android';

export type PushPermission = 'unsupported' | 'undetermined' | 'denied' | 'granted';

export type PushSettings = { replies: boolean; likes: boolean; follows: boolean };

if (pushSupported) {
  // With the app open the Feed badge already updates live: no banner, no sound.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Android's per-type switches in system settings; ids match the server's `channelId`. */
async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  const { AndroidImportance: I } = Notifications;
  await Promise.all([
    Notifications.setNotificationChannelAsync('replies', { name: 'Replies', importance: I.HIGH }),
    Notifications.setNotificationChannelAsync('likes', { name: 'Likes', importance: I.DEFAULT }),
    Notifications.setNotificationChannelAsync('follows', {
      name: 'New followers',
      importance: I.DEFAULT,
    }),
  ]);
}

/**
 * 'denied' only when the system won't show its prompt again. Android 13+
 * reports a permission it has never asked for as denied, with `canAskAgain`.
 */
function toPermission(p: Notifications.NotificationPermissionsStatus): PushPermission {
  if (p.status === 'granted') return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

export async function getPushPermission(): Promise<PushPermission> {
  if (!pushSupported) return 'unsupported';
  return toPermission(await Notifications.getPermissionsAsync());
}

/** The permission, re-read whenever the app comes back (the user may have changed it in Settings). */
export function usePushPermission() {
  const [permission, setPermission] = useState<PushPermission | null>(null);
  useEffect(() => {
    const read = () => getPushPermission().then(setPermission, () => setPermission('unsupported'));
    read();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && read());
    return () => sub.remove();
  }, []);
  return [permission, setPermission] as const;
}

let token: string | null = null;

async function deviceToken(): Promise<string> {
  token ??= (await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID })).data;
  return token;
}

async function register() {
  await ensureChannels();
  const { error } = await supabase.rpc('register_push_token', {
    p_token: await deviceToken(),
    p_platform: Platform.OS,
  });
  if (error) throw error;
}

/**
 * Shows the system prompt (once — iOS never asks twice) and, if allowed,
 * registers this phone. Android 13+ needs a channel before it will prompt.
 */
export async function enablePush(): Promise<PushPermission> {
  if (!pushSupported) return 'unsupported';
  await ensureChannels();
  const permission = toPermission(await Notifications.requestPermissionsAsync());
  if (permission === 'granted') await register();
  return permission;
}

/**
 * On every signed-in start: re-registers if allowed, which refreshes the
 * token's `updated_at` (tokens unseen for 90 days stop receiving) and picks up
 * a token the OS rotated. Never prompts.
 */
export async function syncPush() {
  if ((await getPushPermission()) === 'granted') await register();
}

/**
 * Before signing out: this phone stops receiving the account's pushes. Best
 * effort and bounded — an offline sign-out must still sign out; the server
 * hands the token to the next account that registers it anyway.
 */
export async function unregisterPush() {
  if (!pushSupported) return;
  const work = (async () => {
    if ((await getPushPermission()) !== 'granted') return;
    const { q } = await deleteMine('push_tokens');
    await q.eq('token', await deviceToken());
    await Notifications.setBadgeCountAsync(0);
  })();
  await Promise.race([work.catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
}

/** This phone's switches; null when it isn't registered. */
export async function getPushSettings(): Promise<PushSettings | null> {
  const { q } = await selectMine('push_tokens', 'replies, likes, follows');
  const { data, error } = await q.eq('token', await deviceToken()).maybeSingle();
  if (error) throw error;
  return (data as PushSettings | null) ?? null;
}

export async function setPushSetting(key: keyof PushSettings, value: boolean) {
  const { q } = await updateMine('push_tokens', { [key]: value });
  const { error } = await q.eq('token', await deviceToken());
  if (error) throw error;
}

/** The icon badge mirrors the in-app unread count. No-op without permission. */
export function setAppBadge(count: number) {
  if (pushSupported) Notifications.setBadgeCountAsync(count).catch(() => {});
}

// Only the two places a notification row can open; anything else in `data` is ignored.
const PUSH_URL = /^\/(review|user)\/[0-9a-f-]{36}$/;

/**
 * Opens what a tapped push points at — the same screen its in-app row opens.
 * Covers a tap that launched the app too; waits until a session exists.
 */
function usePushTapsNative(signedIn: boolean) {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!signedIn || !response) return;
    const id = response.notification.request.identifier;
    if (opened.current === id) return;
    // Remembered and cleared first, so a remount or a later sign-in can't open it again.
    opened.current = id;
    Notifications.clearLastNotificationResponseAsync().catch(() => {});
    const url = response.notification.request.content.data?.url;
    if (typeof url === 'string' && PUSH_URL.test(url)) router.push(url as never);
  }, [response, signedIn, router]);
}

export const usePushTaps: (signedIn: boolean) => void = pushSupported
  ? usePushTapsNative
  : () => {};
