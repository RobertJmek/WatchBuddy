import { useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { setRowDragging } from '@/components/title-menu';
import { useTabPager } from '@/lib/tab-pager';

/** One direction of a swipe row: how far to drag, what fires, what shows behind. */
export type SwipeSide = {
  /** Drag distance in points past which letting go commits. */
  threshold: number;
  onCommit: () => void;
  /** Drawn under the row, uncovered as it slides. */
  action: ReactNode;
};

// Under `SwipeNav`'s 12, so a row's drag still wins over the screen swipe
// around it; over the 10pt at which a poster's hold gives up on a moving finger.
const ACTIVATE = 11;
// A drag that goes vertical first is a scroll.
const FAIL_Y = 14;
// A fling counts for a bit of distance, as it did in `Swipeable`.
const TOSS = 0.05;
const SNAP_BACK = { damping: 20, stiffness: 300 };

/**
 * A row that slides sideways under a finger and fires once past a threshold,
 * then springs back. The base of `SwipeToLogRow` and `SwipeToDismissRow`.
 *
 * Built on `GestureDetector` rather than RNGH's classic `Swipeable` (#148)
 * so it can make the tab pager wait (`blocksExternalGesture`, as `SwipeNav`
 * does): on iOS the pager's horizontal scroll took the drag from every row in a
 * tab. Two other things it needs from around it: the list must not be hidden
 * with `display: none` (on iOS a gesture whose view isn't in the window within
 * 2.5 s of mounting never attaches), and a poster's hold must not open its menu
 * mid-swipe (`setRowDragging`).
 */
export function SwipeRow({
  children,
  onSwipeRight,
  onSwipeLeft,
}: {
  children: ReactNode;
  onSwipeRight?: SwipeSide;
  onSwipeLeft?: SwipeSide;
}) {
  const tabPager = useTabPager();
  const x = useSharedValue(0);
  const canRight = !!onSwipeRight;
  const canLeft = !!onSwipeLeft;
  const rightAt = onSwipeRight?.threshold ?? 0;
  const leftAt = onSwipeLeft?.threshold ?? 0;
  const commitRight = onSwipeRight?.onCommit;
  const commitLeft = onSwipeLeft?.onCommit;
  // Inside the tab pager on iOS, RNGH's activation doesn't cancel the touch
  // React Native is tracking, so the row's own Pressable would still fire its
  // tap on release. While the row is dragging, its wrapper takes the responder
  // instead, which cancels that press.
  const dragging = useRef(false);
  const setDragging = (value: boolean) => {
    dragging.current = value;
    setRowDragging(value);
  };

  /* eslint-disable react-hooks/refs -- `dragging` is written from gesture
     callbacks and read in a responder callback, never while rendering. */
  let pan = Gesture.Pan()
    .enabled(canRight || canLeft)
    .failOffsetY([-FAIL_Y, FAIL_Y])
    .onStart(() => {
      scheduleOnRN(setDragging, true);
    })
    .onUpdate((e) => {
      x.value = Math.min(
        canRight ? Infinity : 0,
        Math.max(canLeft ? -Infinity : 0, e.translationX),
      );
    })
    .onEnd((e, success) => {
      // A cancelled drag (the scroll view or a screen swipe took it) never commits.
      if (!success) return;
      const d = e.translationX + e.velocityX * TOSS;
      if (commitRight && d >= rightAt) scheduleOnRN(commitRight);
      else if (commitLeft && d <= -leftAt) scheduleOnRN(commitLeft);
    })
    .onFinalize(() => {
      x.value = withSpring(0, SNAP_BACK);
      scheduleOnRN(setDragging, false);
    });
  pan =
    canRight && canLeft
      ? pan.activeOffsetX([-ACTIVATE, ACTIVATE])
      : canRight
        ? pan.activeOffsetX(ACTIVATE).failOffsetX(-ACTIVATE)
        : pan.activeOffsetX(-ACTIVATE).failOffsetX(ACTIVATE);
  if (tabPager) pan = pan.blocksExternalGesture(tabPager.native);
  /* eslint-enable react-hooks/refs */

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const rightStyle = useAnimatedStyle(() => ({ opacity: x.value > 0 ? 1 : 0 }));
  const leftStyle = useAnimatedStyle(() => ({ opacity: x.value < 0 ? 1 : 0 }));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.container}>
        {onSwipeRight && (
          <Animated.View style={[styles.under, rightStyle]}>
            {onSwipeRight.action}
          </Animated.View>
        )}
        {onSwipeLeft && (
          <Animated.View style={[styles.under, leftStyle]}>
            {onSwipeLeft.action}
          </Animated.View>
        )}
        <Animated.View
          style={rowStyle}
          onMoveShouldSetResponderCapture={() => dragging.current}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  under: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
});
