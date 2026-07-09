/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// "Late Show" palette. Teal is the brand/interactive accent (from the logo);
// amber is the ambient "projector glow" used sparingly for warmth. Both live in
// the per-scheme Colors as `tint`/`glow` so they adapt to dark vs. warm-paper.
export const Accent = '#0D9488';
export const AccentText = '#ffffff';
export const Danger = '#E5484D';

/** Neutral fill behind avatars/posters while their image loads (works on any theme). */
export const PlaceholderBg = '#0002';

export const Colors = {
  // Daylight matinee — warm paper, not clinical white.
  light: {
    text: '#1A1714',
    background: '#F4F1EA',
    backgroundElement: '#EBE6DB',
    backgroundSelected: '#E0DACB',
    textSecondary: '#6B6258',
    border: '#DED7C9',
    tint: '#0B7C72',
    glow: '#B5811D',
  },
  // The theater — warm near-black, warm projector-light text (never pure white).
  dark: {
    text: '#F5F1E8',
    background: '#0A0A0B',
    backgroundElement: '#141211',
    backgroundSelected: '#201D1B',
    textSecondary: '#9A938A',
    border: '#262220',
    tint: '#14B8A6',
    glow: '#E8B23A',
  },
} as const;

/** Ambient amber "projector glow" — theme-aware default lives in Colors.glow. */
export const Glow = '#E8B23A';

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Type voice. Display = Bodoni Moda (high-contrast Didone, the film-poster /
 * end-credits serif); body & UI = Archivo. Family names are the per-weight keys
 * loaded by `useFonts` in the root layout — RN bakes the weight into the family,
 * so set `fontFamily` (not `fontWeight`) when using these.
 */
export const Type = {
  display: 'BodoniModa_700Bold',
  displaySemi: 'BodoniModa_600SemiBold',
  body: 'Archivo_400Regular',
  medium: 'Archivo_500Medium',
  semibold: 'Archivo_600SemiBold',
  bold: 'Archivo_700Bold',
} as const;

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
