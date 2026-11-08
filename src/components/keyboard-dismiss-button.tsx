import { Keyboard, Platform, Pressable, StyleSheet } from 'react-native';
import { KeyboardStickyView, useKeyboardState } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { IconSymbol } from '@/components/icon-symbol';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A small "hide keyboard" button that rides just above the keyboard, at the
 * right edge. iOS only: its keyboard has no key that hides it (Return can mean
 * Search or Send), while Android's keyboard and navigation bar both have one.
 *
 * Render it once per screen, as the last child of the screen's root, so it
 * floats over the content. Needs the root `KeyboardProvider`, which a `Modal`
 * does not get (see AGENTS.md).
 */
export function KeyboardDismissButton() {
  const c = useTheme();
  const visible = useKeyboardState((state) => state.isVisible);
  if (Platform.OS !== 'ios') return null;
  return (
    <KeyboardStickyView offset={{ opened: -Spacing.two }} style={styles.sticky} pointerEvents="box-none">
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
