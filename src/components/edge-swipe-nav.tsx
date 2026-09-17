import { useFocusEffect } from "expo-router";
import { type ReactNode, useCallback, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

/**
 * A swipe *shortcut* to a sibling screen: drag leftwards from the screen's
 * right edge and `onSwipe` fires once, at release. The caller does the
 * navigation (`router.push` to the sibling), so the transition stays the
 * native stack's — nothing is animated in JS.
 *
 * Why the right edge, and only the right edge:
 * - The left edge is iOS's back gesture, and with `fullScreenGestureEnabled`
 *   the whole screen pops on a rightward drag. Leftward from the right edge
 *   is the one direction nothing else claims.
 * - The gesture can only *begin* inside a strip `EDGE_WIDTH` wide (`hitSlop`
 *   with `width` + `right`), so rows that own a horizontal pan mid-screen —
 *   `SwipeToLogRow`, `RatingBar`, poster shelves — never see it. A drag that
 *   starts on the strip and goes vertical fails fast (`failOffsetY`) and the
 *   scroll view underneath keeps it, because the detector wraps the content
 *   instead of covering it.
 */

/** Points from the right edge in which the swipe may start. */
const EDGE_WIDTH = 24;
/** Leftward travel that turns a touch into a swipe. */
const ACTIVATE_DISTANCE = 20;
/** Leftward travel at release that counts as a committed swipe. */
const COMMIT_DISTANCE = 60;
/** …or a flick faster than this (pt/s), whatever the distance. */
const COMMIT_VELOCITY = 600;

type Props = {
  /**
   * Fires once per committed swipe. Pass `undefined` while there is nothing
   * to navigate to (the sibling's params aren't known yet): the gesture is
   * then disabled outright, instead of firing, doing nothing, and leaving
   * `busy` set until the screen is next focused.
   */
  onSwipe?: () => void;
  children: ReactNode;
};

export function EdgeSwipeNav({ onSwipe, children }: Props) {
  // A swipe pushes a screen. Until this one regains focus a second swipe —
  // one that lands during the transition — must not push another copy.
  const busy = useRef(false);
  useFocusEffect(
    useCallback(() => {
      busy.current = false;
    }, []),
  );

  // Same idiom as `rating-bar.tsx`: `runOnJS` because the callback only
  // navigates, and there is nothing on the UI thread for it to drive.
  /* eslint-disable react-hooks/refs -- the builder is constructed during
     render, but its callback only ever runs from the gesture, which is
     exactly when reading `busy.current` is correct. */
  const pan = Gesture.Pan()
    .enabled(!!onSwipe)
    .hitSlop({ right: 0, width: EDGE_WIDTH })
    .activeOffsetX(-ACTIVATE_DISTANCE)
    .failOffsetY([-14, 14])
    .runOnJS(true)
    .onEnd((e, success) => {
      // `success` is false when another recognizer took the touch — the
      // native swipe-back or the scroll view — and the pan was cancelled.
      // Its translation may still be past the threshold; it must not count.
      if (!success || busy.current || !onSwipe) return;
      if (
        e.translationX <= -COMMIT_DISTANCE ||
        e.velocityX <= -COMMIT_VELOCITY
      ) {
        busy.current = true;
        onSwipe();
      }
    });
  /* eslint-enable react-hooks/refs */

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
