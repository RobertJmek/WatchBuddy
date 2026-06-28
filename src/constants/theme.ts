/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Brand accent (teal). A single accent reads well on both light and dark
// surfaces; the surfaces themselves adapt to the color scheme below.
export const Accent = '#0D9488';
export const AccentText = '#ffffff';
export const Danger = '#E5484D';

export const Colors = {
  light: {
    text: '#0A0A0B',
    background: '#ffffff',
    backgroundElement: '#F2F3F5',
    backgroundSelected: '#E6E8EB',
    textSecondary: '#60646C',
    border: '#E4E6E9',
  },
  dark: {
    text: '#F2F3F5',
    background: '#0B0D0E',
    backgroundElement: '#17191C',
    backgroundSelected: '#23262A',
    textSecondary: '#A1A6AD',
    border: '#26292E',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
