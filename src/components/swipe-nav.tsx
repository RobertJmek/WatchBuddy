import { useNavigation } from 'expo-router';
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, type NativeGesture } from 'react-native-gesture-handler';

/**
 * Swipe *shortcuts* between screens: a horizontal drag anywhere on the screen
 * fires `onSwipeLeft` / `onSwipeRight` once, at release. (Closing a modal by
 * pulling it down is not a pan — see `src/lib/pull-to-dismiss.ts`.) The
 * caller does the navigation (`router.push` / `router.back`), so every
 * transition stays the native stack's — nothing is animated in JS.
 *
 * How it loses to everything else that owns a horizontal drag — swipe-to-log
 * and swipe-to-dismiss rows, drag-to-rate, poster shelves, the tab pager:
 * by threshold, not by area. The pan here needs `activateDistance` (12pt) of
 * travel before it activates; every row swipe (10), the rating bar (~6) and a
 * native scroll (8dp) activate sooner, and RNGH cancels
 * a handler still waiting when another one activates on the same touch. On
 * Android the root view sees each touch before any native child does, so the
 * order is fixed; on iOS it is UIKit's first-to-begin with the same
 * thresholds. A drag that goes vertical fails fast (`failOffsetY`) and the
 * scroll view underneath keeps it, because the detector wraps the content
 * instead of covering it. ADR 0023 has the citations.
 *
 * 12pt and not more because of Android: a vertical `ScrollView` claims any drag
 * that travels 8dp vertically, so the pan has to reach its threshold before
 * that. At 20pt a swipe had to stay within ~22° of horizontal; at 12, ~34°.
 *
 * **Don't nest two of these.** Every pushed screen is already wrapped in one
 * by the root layout (the back-swipe); a screen that adds its own must give
 * it `onSwipeRight` too. With two nested, the outer pan never activated on
 * Android, even for the direction the inner one had failed — measured on the
 * title screen, whose back-swipe was dead in v1.20.0.
 *
 * A direction with no handler *fails early* (`failOffsetX` at 8pt) instead of
 * merely not firing, so the scroll around this one — the tab pager — can take
 * the drag.
 */

/** Travel that turns a horizontal touch into this pan. */
const ACTIVATE_DISTANCE = 12;
/** Travel in a direction with no handler at which the pan gives up. */
const FAIL_DISTANCE = 8;
/** Horizontal travel at release that counts as a committed swipe. */
const COMMIT_DISTANCE = 60;
/** …or a flick faster than this (pt/s), whatever the distance. */
const COMMIT_VELOCITY = 600;

type Props = {
  /**
   * Fires once per committed swipe. Pass `undefined` while there is nothing
   * to navigate to (the target's params aren't known yet): that direction is
   * then disabled outright, instead of firing into nothing.
   */
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** A native gesture this pan must beat — the tab pager's, inside a tab. */
  blocks?: NativeGesture | null;
  /** Override the horizontal activation distance (inside the tab pager it must stay under the pager's 16dp slop). */
  activateDistance?: number;
  children: ReactNode;
};

export function SwipeNav({
  onSwipeLeft,
  onSwipeRight,
  blocks,
  activateDistance = ACTIVATE_DISTANCE,
  children,
}: Props) {
  // A swipe that pushes or pops a screen takes the focus away at once, so a
  // second swipe landing during the transition finds it unfocused and does
  // nothing. A swipe that stays on the screen (the Feed's segments) keeps the
  // focus, so the next one fires too. A flag set on fire and cleared on focus
  // would get that second case wrong: nothing re-focuses a segment switch.
  const navigation = useNavigation();
  const fire = (handler: () => void) => {
    if (navigation.isFocused()) handler();
  };

  // Same idiom as `rating-bar.tsx`: `runOnJS` because the callbacks only
  // navigate, and there is nothing on the UI thread for them to drive.
  let horizontal = Gesture.Pan()
    .enabled(!!onSwipeLeft || !!onSwipeRight)
    .failOffsetY([-14, 14])
    .runOnJS(true)
    .onEnd((e, success) => {
      // `success` is false when another recognizer took the touch — the
      // native swipe-back, a row, the scroll view — and the pan was cancelled.
      // Its translation may still be past the threshold; it must not count.
      if (!success) return;
      if (
        onSwipeLeft &&
        (e.translationX <= -COMMIT_DISTANCE || e.velocityX <= -COMMIT_VELOCITY)
      ) {
        fire(onSwipeLeft);
      } else if (
        onSwipeRight &&
        (e.translationX >= COMMIT_DISTANCE || e.velocityX >= COMMIT_VELOCITY)
      ) {
        fire(onSwipeRight);
      }
    });
  if (onSwipeLeft && onSwipeRight) {
    horizontal = horizontal.activeOffsetX([-activateDistance, activateDistance]);
  } else if (onSwipeLeft) {
    horizontal = horizontal.activeOffsetX(-activateDistance).failOffsetX(FAIL_DISTANCE);
  } else {
    horizontal = horizontal.activeOffsetX(activateDistance).failOffsetX(-FAIL_DISTANCE);
  }
  if (blocks) horizontal = horizontal.blocksExternalGesture(blocks);

  return (
    <GestureDetector gesture={horizontal}>
      <View style={styles.fill}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
