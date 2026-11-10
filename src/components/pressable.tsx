import { Pressable as RNPressable, type PressableProps } from 'react-native';

/**
 * React Native's `Pressable` with the app's press feedback built in: it dims to
 * 60% while a finger is on it, so every tap answers at once.
 *
 * A `style` function still wins (the caller draws its own pressed state), and
 * `dim={false}` is for a surface that must not react, like a sheet's backdrop.
 * Cards and rows that should spring instead use `PressScale`.
 */
export function Pressable({ style, dim = true, ...rest }: PressableProps & { dim?: boolean }) {
  return (
    <RNPressable
      {...rest}
      style={
        typeof style === 'function' || !dim
          ? style
          : ({ pressed }) => [style, pressed && PRESSED]
      }
    />
  );
}

const PRESSED = { opacity: 0.6 };
