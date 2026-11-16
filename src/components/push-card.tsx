import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Pressable } from '@/components/pressable';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { markTipDone, useTipVisible } from '@/lib/onboarding';
import { enablePush, usePushPermission } from '@/lib/push';

/**
 * The ask for accounts that never saw the onboarding step (ADR 0039): atop the
 * Notifications segment, where what it offers already shows. Only while the
 * system hasn't been asked; "Not now" hides it for good on this install, like a
 * `Tip`. The system prompt comes only after "Turn on".
 */
export function PushCard({ style }: { style?: ViewStyle }) {
  const c = useTheme();
  const [permission, setPermission] = usePushPermission();
  const open = useTipVisible('push-card');
  if (!open || permission !== 'undetermined') return null;

  async function turnOn() {
    markTipDone('push-card');
    setPermission(await enablePush().catch(() => 'undetermined' as const));
  }

  return (
    <View style={[styles.card, { backgroundColor: c.backgroundElement }, style]}>
      <View style={styles.text}>
        <ThemedText type="label">Get notified</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          When someone replies, likes your review or follows you.
        </ThemedText>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => markTipDone('push-card')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Not now">
          <ThemedText type="smallBold" themeColor="textSecondary">
            Not now
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={turnOn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Turn on notifications">
          <ThemedText type="smallBold" themeColor="tint">
            Turn on
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

/** Whether the card is showing, so the screen keeps to one ask at a time. */
export function usePushCardOpen() {
  const [permission] = usePushPermission();
  return useTipVisible('push-card') && permission === 'undetermined';
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.three },
  text: { gap: Spacing.half },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.four },
});
