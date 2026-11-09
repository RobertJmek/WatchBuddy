import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';
import { Keyboard, Platform, StyleSheet } from 'react-native';
import { KeyboardStickyView, useKeyboardState } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { IconSymbol } from '@/components/icon-symbol';
import { Pressable } from '@/components/pressable';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Extra height to clear a bar that itself rides on the keyboard (the review
// thread's composer). The focused screen sets it; 0 everywhere else.
let lift = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const setLift = (v: number) => {
  if (v === lift) return;
  lift = v;
  listeners.forEach((l) => l());
};

/**
 * For a screen with a bar pinned above the keyboard (a composer): raises the
 * hide-keyboard button by that bar's height while the screen is focused, so
 * the button never covers the bar's own buttons.
 */
export function useKeyboardButtonLift(height: number) {
  useFocusEffect(
    useCallback(() => {
      setLift(height);
      return () => setLift(0);
    }, [height]),
  );
}

/**
 * A small "hide keyboard" button that rides just above the keyboard, at the
 * right edge, on every screen. iOS only: its keyboard has no key that hides it
 * (Return can mean Search or Send), while Android's keyboard and navigation
 * bar both have one.
 *
 * Mounted ONCE, in the root layout, so every screen gets it with nothing to
 * add. A screen whose own bar rides on the keyboard calls
 * `useKeyboardButtonLift`. It cannot appear inside an RN `Modal` (a separate
 * window); no text field lives in one today.
 */
export function KeyboardDismissButton() {
  const c = useTheme();
  const visible = useKeyboardState((state) => state.isVisible);
  const extra = useSyncExternalStore(subscribe, () => lift);
  if (Platform.OS !== 'ios') return null;
  return (
    <KeyboardStickyView
      offset={{ opened: -Spacing.two - extra }}
      style={styles.sticky}
      pointerEvents="box-none">
      {visible && (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(100)}>
          <Pressable
            onPress={() => Keyboard.dismiss()}
            hitSlop={8}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: c.backgroundElement, borderColor: c.border },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Hide keyboard">
            <IconSymbol name="chevron.down" size={20} tintColor={c.text} />
          </Pressable>
        </Animated.View>
      )}
    </KeyboardStickyView>
  );
}

const styles = StyleSheet.create({
  sticky: { position: 'absolute', right: Spacing.three, bottom: 0 },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  pressed: { opacity: 0.6 },
});
