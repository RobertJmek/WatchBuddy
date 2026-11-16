import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { IconSymbol } from '@/components/icon-symbol';
import { SwipeRow } from '@/components/swipe-row';
import { ThemedText } from '@/components/themed-text';
import { AccentText, Danger, Spacing } from '@/constants/theme';

/**
 * Swipe a row right to get rid of it. One direction, one action: dragging past a
 * threshold fires `onDismiss` once and snaps back, revealing a red `Dismiss`
 * underneath so the gesture explains itself mid-drag.
 *
 * Right, not left, by Robert's call. It does mean the same drag means opposite
 * things on two screens — swiping a search result right *logs* a watch — so if
 * that ever reads as wrong, this is the component to flip, not that one.
 *
 * A sibling of `swipe-to-log-row.tsx`, not a mode of it: that one is a two-way
 * log/undo row whose whole vocabulary (`onLog`, `logLabel`, `longLog`) is about
 * watches. Folding a third meaning into it would make both harder to read than
 * the ~30 lines they each cost.
 *
 * **No haptics in here.** The caller owns them, so wiring the same action to a
 * button later can't double-buzz. The gesture itself lives in `swipe-row.tsx`.
 *
 * The caller also owns the accessible path, for the reason spelled out in
 * `swipe-to-log-row.tsx`: custom actions are only exposed for the *focused*
 * element, so they belong on the row's own `Pressable`, not on a wrapper here.
 * Dismissal has no tap equivalent anywhere in the app, so for this row that
 * action is the only way a screen reader can reach the feature at all.
 */
export function SwipeToDismissRow({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  /** Fires once, when the rightward drag crosses the threshold. */
  onDismiss: () => void;
}) {
  const { width } = useWindowDimensions();

  return (
    <SwipeRow
      onSwipeRight={{
        // Same short-flick distance as a movie's swipe-to-log. Dismissing is
        // reversible (an Undo strip takes its place), so it doesn't earn the
        // long, deliberate drag a whole series does.
        threshold: width * 0.22,
        onCommit: onDismiss,
        action: (
          <View style={styles.action}>
            <IconSymbol name="xmark" size={20} tintColor={AccentText} />
            <ThemedText style={styles.actionText}>Dismiss</ThemedText>
          </View>
        ),
      }}>
      {children}
    </SwipeRow>
  );
}

const styles = StyleSheet.create({
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    backgroundColor: Danger,
    borderRadius: Spacing.three,
  },
  actionText: { color: AccentText, fontWeight: '700' },
});
