import { View, type ViewProps } from 'react-native';
import {
  initialWindowMetrics,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

/**
 * Top-edge safe-area padding that is correct on the very first frame.
 *
 * expo-router's NativeTabs wraps each tab screen in its own SafeAreaProvider
 * with no `initialMetrics`, so `useSafeAreaInsets()` reports `top: 0` for the
 * first render frame of a lazily-mounted tab. With a plain
 * `SafeAreaView edges={['top']}` that means the header paints flush under the
 * status bar for one frame and then jumps down once insets are measured.
 *
 * Falling back to the window's launch-time top inset (known synchronously via
 * `initialWindowMetrics`) until the live value resolves removes that jump. A
 * drop-in replacement for `<SafeAreaView edges={['top']}>` on tab screens.
 */
export function TopSafeAreaView({ style, ...rest }: ViewProps) {
  const insets = useSafeAreaInsets();
  const top = insets.top || initialWindowMetrics?.insets.top || 0;
  return <View style={[{ paddingTop: top }, style]} {...rest} />;
}
