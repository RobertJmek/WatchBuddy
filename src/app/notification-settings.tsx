import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Linking, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { BarButton } from '@/components/bottom-bar';
import { Intro } from '@/components/intro';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Spacing } from '@/constants/theme';
import { useBottomGap } from '@/hooks/use-bottom-gap';
import { useTheme } from '@/hooks/use-theme';
import { hapticFailure, hapticToggle } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import {
  enablePush,
  getPushSettings,
  setPushSetting,
  syncPush,
  usePushPermission,
  type PushSettings,
} from '@/lib/push';

const ROWS: { key: keyof PushSettings; label: string; note: string }[] = [
  { key: 'replies', label: 'Replies', note: 'Someone replies to your review or comment' },
  { key: 'likes', label: 'Likes', note: 'At most one per review an hour' },
  { key: 'follows', label: 'New followers', note: 'At most one an hour' },
];

/**
 * Which notifications reach this phone (ADR 0039). The switches belong to the
 * phone, next to the system permission they depend on: without it there is
 * nothing to switch, so the screen offers to turn it on (or opens Settings once
 * the system has said no — iOS never asks twice).
 */
export default function NotificationSettingsScreen() {
  const c = useTheme();
  const bottomGap = useBottomGap();
  const queryClient = useQueryClient();
  const [permission, setPermission] = usePushPermission();

  const granted = permission === 'granted';
  const { data: settings, isError, refetch } = useQuery({
    queryKey: keys.pushSettings(),
    // Registers first, so a phone that allowed notifications elsewhere (or whose
    // last registration failed offline) always has a row to show.
    queryFn: async () => {
      await syncPush();
      return getPushSettings();
    },
    enabled: granted,
  });

  async function toggle(key: keyof PushSettings, value: boolean) {
    hapticToggle(value);
    const previous = settings;
    queryClient.setQueryData<PushSettings | null>(keys.pushSettings(), (old) =>
      old ? { ...old, [key]: value } : old,
    );
    try {
      await setPushSetting(key, value);
    } catch {
      hapticFailure();
      queryClient.setQueryData(keys.pushSettings(), previous);
    }
  }

  async function turnOn() {
    const next = await enablePush().catch(() => 'undetermined' as const);
    setPermission(next);
    if (next === 'granted') queryClient.invalidateQueries({ queryKey: keys.pushSettings() });
  }

  const body =
    permission === 'denied'
      ? "Notifications are off for WatchBuddy in your phone's settings."
      : granted && isError
        ? "Couldn't load your notification settings. Check your connection and try again."
        : granted
          ? 'Choose what reaches this phone.'
        : 'Get a notification when someone replies, likes your review or follows you.';

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: '' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomGap }]}>
        <Intro title="Notifications" body={permission ? body : undefined} />

        {granted && settings && (
          <View>
            {ROWS.map((row) => (
              <View key={row.key} style={[styles.row, { borderBottomColor: c.border }]}>
                <View style={styles.rowText}>
                  <ThemedText type="label">{row.label}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {row.note}
                  </ThemedText>
                </View>
                <Switch
                  value={settings[row.key]}
                  onValueChange={(v) => toggle(row.key, v)}
                  trackColor={{ true: Accent }}
                  accessibilityLabel={row.label}
                  accessibilityHint={row.note}
                />
              </View>
            ))}
          </View>
        )}

        {granted && isError && (
          <BarButton title="Try again" secondary onPress={() => void refetch()} />
        )}
        {permission === 'undetermined' && (
          <BarButton title="Turn on notifications" onPress={turnOn} />
        )}
        {permission === 'denied' && (
          <BarButton title="Open Settings" onPress={() => void Linking.openSettings()} />
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, gap: Spacing.five },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: Spacing.half },
});
