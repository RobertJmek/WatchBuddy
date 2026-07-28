import { useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { IconSymbol } from '@/components/icon-symbol';
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
 * Two rules inherited from that component, both learned the hard way:
 *
 * - **`Swipeable` comes from the package's *main* entry**, never the
 *   `react-native-gesture-handler/ReanimatedSwipeable` subpath. Mixing the two
 *   pulls a second copy of the `RNGestureHandlerButton` native component into
 *   the bundle and the app dies at launch ("Tried to register two views with the
 *   same name"). Neither `tsc` nor `expo export` sees it — v1.12.0 shipped that
 *   way. The app's `GestureHandlerRootView` (`_layout.tsx`) must be mounted,
 *   which it is everywhere except inside an RN `Modal`.
 * - **No haptics in here.** The caller owns them, so wiring the same action to a
 *   button later can't double-buzz.
 */
export function SwipeToDismissRow({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  /** Fires once, when the rightward drag crosses the threshold. */
  onDismiss: () => void;
}) {
  const ref = useRef<Swipeable>(null);
  const { width } = useWindowDimensions();

  return (
    <Swipeable
      ref={ref}
      // Same short-flick distance as a movie's swipe-to-log. Dismissing is
      // reversible (an Undo strip takes its place), so it doesn't earn the long,
      // deliberate drag a whole series does.
      leftThreshold={width * 0.22}
      onSwipeableWillOpen={() => {
        onDismiss();
        ref.current?.close();
      }}
      // Left actions are what a *right* drag reveals.
      renderLeftActions={() => (
        <View style={styles.action}>
          <IconSymbol name="xmark" size={20} tintColor={AccentText} />
          <ThemedText style={styles.actionText}>Dismiss</ThemedText>
        </View>
      )}>
      {children}
    </Swipeable>
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
