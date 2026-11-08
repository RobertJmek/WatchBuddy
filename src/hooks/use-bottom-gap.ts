import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';

/**
 * How far the lowest button on a screen sits above the screen's bottom edge:
 * the home indicator or gesture bar (edge-to-edge on Android) plus 32pt.
 * Robert's rule: no button on any page sits lower than Edit Profile's Delete
 * account, which is exactly this. Use it as the bottom padding of a pinned
 * action bar and of every scroll view's content.
 */
export function useBottomGap() {
  return useSafeAreaInsets().bottom + Spacing.five;
}
