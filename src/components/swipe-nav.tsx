import { useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useMemo, useRef } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  type NativeGesture,
} from 'react-native-gesture-handler';

/**
 * Swipe *shortcuts* between screens: a horizontal drag anywhere on the screen
 * fires `onSwipeLeft` / `onSwipeRight` once, at release, and a downward drag
 * that started with the screen's scroll view at the top fires `onPullDown`.
 * The caller does the navigation (`router.push` / `router.back`), so every
 * transition stays the native stack's — nothing is animated in JS.
 *
 * How it loses to everything else that owns a horizontal drag — swipe-to-log
 * and swipe-to-dismiss rows, drag-to-rate, poster shelves, the tab pager:
 * by threshold, not by area. The pan here needs `activateDistance` (20pt on a
 * pushed screen) of travel before it activates; every row swipe (10), the
 * rating bar (~6) and a native scroll (8dp) activate sooner, and RNGH cancels
 * a handler still waiting when another one activates on the same touch. On
 * Android the root view sees each touch before any native child does, so the
 * order is fixed; on iOS it is UIKit's first-to-begin with the same
 * thresholds. A drag that goes vertical fails fast (`failOffsetY`) and the
 * scroll view underneath keeps it, because the detector wraps the content
 * instead of covering it. ADR 0023 has the citations.
 *
 * A direction with no handler *fails early* (`failOffsetX` at 8pt) instead of
 * merely not firing, so a pan around this one — the tab pager, the stack's
 * back-swipe wrapper — can take the drag.
 */

/** Travel that turns a horizontal touch into this pan, on a pushed screen. */
const ACTIVATE_DISTANCE = 20;
/** Travel in a direction with no handler at which the pan gives up. */
const FAIL_DISTANCE = 8;
/** Horizontal travel at release that counts as a committed swipe. */
const COMMIT_DISTANCE = 60;
/** …or a flick faster than this (pt/s), whatever the distance. */
const COMMIT_VELOCITY = 600;
/** Downward travel at release that dismisses; deliberately a long pull. */
const PULL_COMMIT_DISTANCE = 120;
const PULL_COMMIT_VELOCITY = 900;

/**
 * The scroll view's side of a pull-down: a `Gesture.Native()` to put on the
 * scrollable (so the pull can run *alongside* the scroll instead of stealing
 * it) and the current offset, read at touch-down and at release.
 */
export type SwipeNavScroll = {
  native: NativeGesture;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle: number;
  atTop: () => boolean;
};

export function useSwipeNavScroll(): SwipeNavScroll {
  const native = useMemo(() => Gesture.Native(), []);
  const offset = useRef(0);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);
  // `<= 1`, not `=== 0`: a bounce reports negative offsets and a content inset
  // can rest slightly off zero.
  const atTop = useCallback(() => offset.current <= 1, []);
  return useMemo(
    () => ({ native, onScroll, scrollEventThrottle: 16, atTop }),
    [native, onScroll, atTop],
  );
}

type Props = {
  /**
   * Fires once per committed swipe. Pass `undefined` while there is nothing
   * to navigate to (the target's params aren't known yet): that direction is
   * then disabled outright, instead of firing, doing nothing, and leaving
   * `busy` set until the screen is next focused.
   */
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Fires once when a drag that began with `scroll` at the top is released past the pull threshold. */
  onPullDown?: () => void;
  /** Required with `onPullDown`; from `useSwipeNavScroll()`. */
  scroll?: SwipeNavScroll;
  /** A native gesture this pan must beat — the tab pager's, inside a tab. */
  blocks?: NativeGesture | null;
  /** Override the horizontal activation distance (inside the tab pager: under its 16dp slop). */
  activateDistance?: number;
  children: ReactNode;
};

export function SwipeNav({
  onSwipeLeft,
  onSwipeRight,
  onPullDown,
  scroll,
  blocks,
  activateDistance = ACTIVATE_DISTANCE,
  children,
}: Props) {
  // A swipe pushes or pops a screen. Until this one regains focus a second
  // swipe — one that lands during the transition — must not do it again.
  const busy = useRef(false);
  useFocusEffect(
    useCallback(() => {
      busy.current = false;
    }, []),
  );
  // Whether the current pull began at the top. A drag that starts mid-list and
  // reaches the top must keep scrolling, not dismiss.
  const startedAtTop = useRef(false);

  const fire = (handler: () => void) => {
    busy.current = true;
    handler();
  };

  // Same idiom as `rating-bar.tsx`: `runOnJS` because the callbacks only
  // navigate, and there is nothing on the UI thread for them to drive.
  /* eslint-disable react-hooks/refs -- the builders are constructed during
     render, but their callbacks only ever run from the gesture, which is
     exactly when reading the refs is correct. */
  let horizontal = Gesture.Pan()
    .enabled(!!onSwipeLeft || !!onSwipeRight)
    .failOffsetY([-14, 14])
    .runOnJS(true)
    .onEnd((e, success) => {
      // `success` is false when another recognizer took the touch — the
      // native swipe-back, a row, the scroll view — and the pan was cancelled.
      // Its translation may still be past the threshold; it must not count.
      if (!success || busy.current) return;
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

  const pullDown = Gesture.Pan()
    .enabled(!!onPullDown && !!scroll)
    .activeOffsetY(12)
    .failOffsetY(-FAIL_DISTANCE)
    .failOffsetX([-ACTIVATE_DISTANCE, ACTIVATE_DISTANCE])
    .runOnJS(true)
    .onBegin(() => {
      startedAtTop.current = scroll?.atTop() ?? false;
    })
    .onEnd((e, success) => {
      if (!success || busy.current || !onPullDown || !scroll) return;
      if (!startedAtTop.current || !scroll.atTop()) return;
      if (e.translationY >= PULL_COMMIT_DISTANCE || e.velocityY >= PULL_COMMIT_VELOCITY) {
        fire(onPullDown);
      }
    });
  // Alongside the scroll, never instead of it: the list scrolls (or bounces)
  // exactly as it would without this pan, which only watches where the drag
  // began and where it ended. Stealing the drag would need a threshold under
  // the scroll view's own, and then every downward drag at the top would
  // stop scrolling.
  if (scroll) pullDown.simultaneousWithExternalGesture(scroll.native);
  /* eslint-enable react-hooks/refs */

  const gesture = onPullDown ? Gesture.Race(horizontal, pullDown) : horizontal;

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.fill}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
