import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Pressable that springs down to ~96% while pressed — the app's standard
 * touch feedback for cards and rows.
 */
export function PressScale({
  style,
  onPressIn,
  onPressOut,
  ...rest
}: PressableProps & { style?: StyleProp<ViewStyle> }) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <AnimatedPressable
      {...rest}
      style={[style, animated]}
      /* eslint-disable react-hooks/immutability -- a Reanimated shared value
         is meant to be assigned; that is its whole interface, and the writes
         below happen in press handlers, never during render. */
      onPressIn={(e) => {
        scale.value = withSpring(0.96, { damping: 20, stiffness: 300 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 20, stiffness: 300 });
        onPressOut?.(e);
      }}
      /* eslint-enable react-hooks/immutability */
    />
  );
}
