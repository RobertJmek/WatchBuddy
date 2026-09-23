import { useState } from 'react';
import { Platform } from 'react-native';
import { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/**
 * Close a bottom-opened screen (a title, a review thread) by pulling it down.
 *
 * - **iOS:** pull the page past its top and let go — the rubber-band overscroll,
 *   read at the end of the drag. No gesture handler.
 * - **Android:** there is no overscroll to read, so the pull is a pan in the
 *   screen's `SwipeNav` (`pullDown`) that only starts in the top zone and only
 *   while the page is at its top. This hook supplies that `atTop`.
 *
 * Neither path puts a gesture over the scroll view. v1.20.0 did — a
 * `Gesture.Native()` wrapped around `KeyboardAwareScrollView` landed on its
 * wrapper view and froze the title's scroll on Android (ADR 0023).
 *
 * **The handler is a Reanimated worklet, and must be.** `KeyboardAwareScrollView`
 * registers its own worklet for every native scroll event (`useScrollState`),
 * and Reanimated then consumes those events on the UI thread: a plain JS
 * `onScroll` / `onScrollEndDrag` prop on it is simply never called. So the
 * scrollable has to be a Reanimated one (`KeyboardAwareScrollView` is; the
 * thread uses `Animated.FlatList`) and gets `onScroll={scrollHandler}`.
 */

/** iOS: pull past the top, in points, at the moment the finger lifts. */
const PULL_DISTANCE = 80;
const IS_IOS = Platform.OS === 'ios';

export function usePullToDismiss(onDismiss: () => void) {
  const [atTop, setAtTop] = useState(true);
  const lastAtTop = useSharedValue(true);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      // `<= 1`, not `=== 0`: a content inset can leave the resting offset a
      // hair off zero. Cross to JS only when the answer changes.
      const top = e.contentOffset.y <= 1;
      if (top !== lastAtTop.value) {
        lastAtTop.value = top;
        scheduleOnRN(setAtTop, top);
      }
    },
    onEndDrag: (e) => {
      if (!IS_IOS) return;
      // The resting top is `-contentInset.top`, not 0, when the scroll view
      // adjusts for a header or a keyboard inset.
      if (e.contentOffset.y + (e.contentInset?.top ?? 0) <= -PULL_DISTANCE) {
        scheduleOnRN(onDismiss);
      }
    },
  }, [onDismiss]);
  return { scrollHandler, atTop };
}
