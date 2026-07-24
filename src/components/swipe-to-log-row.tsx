import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { IconSymbol } from '@/components/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Danger, Spacing } from '@/constants/theme';

type Props = {
  children: React.ReactNode;
  /** Swipe-right → log. Fires once, when the drag crosses the threshold. */
  onLog: () => void;
  /** Label shown on the teal (log) background as you drag right. */
  logLabel: string;
  /** Swipe-left → undo. Omit to disable the undo direction (no red reveal). */
  onUndo?: () => void;
  /**
   * A heavy action (e.g. a whole series is hundreds of episode rows): require a
   * long, deliberate swipe so it can't fire by accident. The long swipe *is* the
   * confirmation.
   */
  longLog?: boolean;
};

/**
 * Auto-commit swipe row: no tap-buttons. Dragging past a threshold fires the
 * action once and snaps back, with a colored icon+label revealed underneath so
 * the gesture is self-explanatory.
 *
 * Uses `Swipeable` from the package's *main* entry (the same module react-navigation
 * already loads) rather than the `react-native-gesture-handler/ReanimatedSwipeable`
 * subpath — mixing the subpath with the main entry pulls a second copy of the
 * `RNGestureHandlerButton` native component into the bundle and crashes at startup
 * ("Tried to register two views with the same name"). The app's
 * `GestureHandlerRootView` (in `_layout.tsx`) must be mounted for it to work.
 */
export function SwipeToLogRow({
  children,
  onLog,
  logLabel,
  onUndo,
  longLog,
}: Props) {
  const ref = useRef<Swipeable>(null);
  const { width } = useWindowDimensions();
  // Thresholds are drag distances in points. A series needs most of the row's
  // width; a movie/episode a short flick. Tunable on-device.
  const logThreshold = width * (longLog ? 0.6 : 0.28);
  const undoThreshold = width * 0.28;

  function handleWillOpen(direction: 'left' | 'right') {
    // Left actions open when swiping *right* → log. Right actions → undo.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (direction === 'left') onLog();
    else onUndo?.();
    ref.current?.close();
  }

  return (
    <Swipeable
      ref={ref}
      friction={2}
      leftThreshold={logThreshold}
      rightThreshold={undoThreshold}
      overshootLeft={false}
      overshootRight={false}
      onSwipeableWillOpen={handleWillOpen}
      renderLeftActions={() => (
        <View style={[styles.action, styles.logAction]}>
          <IconSymbol name="checkmark" size={22} tintColor={AccentText} />
          <ThemedText style={styles.actionText}>{logLabel}</ThemedText>
        </View>
      )}
      renderRightActions={
        onUndo
          ? () => (
              <View style={[styles.action, styles.undoAction]}>
                <ThemedText style={styles.actionText}>Undo</ThemedText>
                <IconSymbol name="arrow.uturn" size={20} tintColor={AccentText} />
              </View>
            )
          : undefined
      }>
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  logAction: { backgroundColor: Accent, justifyContent: 'flex-start' },
  undoAction: { backgroundColor: Danger, justifyContent: 'flex-end' },
  actionText: { color: AccentText, fontWeight: '700' },
});
