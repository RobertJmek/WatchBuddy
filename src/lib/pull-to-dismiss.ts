import { useMemo } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
} from 'react-native';

/**
 * Close a bottom-opened screen (a title, a review thread) by pulling its page
 * down past the top and letting go — iOS's rubber-band overscroll, read from
 * the scroll view's own `onScrollEndDrag`. No gesture handler sits over the
 * scroll view, so scrolling stays entirely native.
 *
 * iOS only. Android's ScrollView does not overscroll into negative offsets, and
 * the pan this replaced (ADR 0023) froze a title's scroll there: its
 * `Gesture.Native()` landed on keyboard-controller's wrapper view instead of the
 * ScrollView. On Android these screens close with back or a swipe right.
 *
 * Spread the result onto the ScrollView / FlatList.
 */

/** Pull past the top, in points, at the moment the finger lifts. */
const PULL_DISTANCE = 80;

export function usePullToDismiss(onDismiss: () => void): {
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
} {
  return useMemo(() => {
    if (Platform.OS !== 'ios') return {};
    return {
      onScrollEndDrag: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, contentInset } = e.nativeEvent;
        // The resting top is `-contentInset.top`, not 0, when the scroll view
        // adjusts for a header or a keyboard inset.
        if (contentOffset.y + (contentInset?.top ?? 0) <= -PULL_DISTANCE) onDismiss();
      },
    };
  }, [onDismiss]);
}
