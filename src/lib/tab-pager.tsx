import { createContext, useContext } from 'react';
import type { NativeGesture } from 'react-native-gesture-handler';

/**
 * What the tab pager exposes to the screens inside it, so a JS swipe on a tab
 * (the Feed's segment swipe) can settle its priority against the pager's own
 * horizontal scroll.
 *
 * - `native` is the `Gesture.Native()` attached to the `PagerView`. A pan that
 *   declares `.blocksExternalGesture(native)` is what the pager's scroll view
 *   waits for on iOS, where two plain UIKit recognizers would otherwise race
 *   first-to-begin. On Android the native handler never activates on the
 *   pager's host view and RNGH's threshold rule already decides.
 * - `setScrollEnabled` is the blunt fallback: freeze the pager while a JS pan
 *   is active, release it when the pan ends.
 *
 * `null` outside the tab pager (a pushed screen, web).
 */
export type TabPager = {
  native: NativeGesture;
  setScrollEnabled: (enabled: boolean) => void;
};

const TabPagerContext = createContext<TabPager | null>(null);

export const TabPagerProvider = TabPagerContext.Provider;

export function useTabPager(): TabPager | null {
  return useContext(TabPagerContext);
}
