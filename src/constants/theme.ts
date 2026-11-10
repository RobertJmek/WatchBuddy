/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Posters carry the colour, so the chrome is neutral: a true-black auditorium
// in dark, a white screen in light. Teal is the brand/interactive accent (from
// the logo); amber is used sparingly. Both live in the per-scheme Colors as
// `tint`/`glow`.
//
// Contrast (WCAG AA, measured): `Accent` and `Danger` are FILLS, chosen so white
// text on them is >= 4.5:1. No single teal or red can also be >= 4.5:1 as text on
// both themes, so text uses the per-scheme `tint` / `danger` / `glow` instead
// (`<ThemedText themeColor="tint">`). Every text token below is >= 4.5:1 on
// background, backgroundElement and backgroundSelected of its scheme.
export const Accent = '#0F766E';
export const AccentText = '#ffffff';
export const Danger = '#C0262D';

/** Neutral fill behind avatars/posters while their image loads (works on any theme). */
export const PlaceholderBg = '#0002';

export const Colors = {
  // The lit screen: white, with cool neutral greys.
  light: {
    text: '#111214',
    background: '#FFFFFF',
    backgroundElement: '#F0F1F3',
    backgroundSelected: '#E3E5E9',
    textSecondary: '#555A63',
    border: '#D9DCE1',
    tint: '#0B6B63',
    glow: '#7A560D',
    danger: '#B3261E',
  },
  // The auditorium: true black (letterbox bars, OLED), cool neutral greys.
  dark: {
    text: '#F4F5F7',
    background: '#000000',
    backgroundElement: '#141518',
    backgroundSelected: '#212328',
    textSecondary: '#9DA1A9',
    border: '#2A2C31',
    tint: '#14B8A6',
    glow: '#E8B23A',
    danger: '#F2555A',
  },
} as const;

/** Ambient amber "projector glow" — theme-aware default lives in Colors.glow. */
export const Glow = '#E8B23A';

/**
 * Neutral hairline that reads on either theme. For static `StyleSheet` values
 * that can't reach the per-scheme `Colors.border`.
 */
export const NeutralBorder = '#8888';

/**
 * The title screen's poster hero sits on a photograph, so it doesn't follow the
 * light/dark theme — it is always the theater: true-black letterbox bars and
 * warm projector-light type, whichever scheme the rest of the app is in. These
 * are that one surface's palette, kept together so it stays coherent.
 */
export const Hero = {
  /** True-black letterbox bars and the backdrop behind a missing still. */
  letterbox: '#000',
  /** Translucent black under the poster while its image loads. */
  scrim: '#0003',
  text: Colors.dark.text,
  textMuted: 'rgba(244,245,247,0.7)',
  /** The poster's own edge. */
  hairline: 'rgba(244,245,247,0.15)',
  /** Outline of the metadata pills. */
  border: 'rgba(244,245,247,0.28)',
  /**
   * Fill of the metadata pills. The hero fades into the page background, which
   * is cream in light mode, so the pills carry their own dark ground.
   */
  pill: 'rgba(0,0,0,0.55)',
  /** Text shadow for hero text that sits where the fade turns light. */
  shadow: 'rgba(0,0,0,0.6)',
  /** Back chevron and header icons, over an arbitrary photograph. */
  headerTint: '#fff',
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Type voice. Display = League Gothic (the condensed gothic of film posters and
 * their billing blocks; one weight, and narrow enough that a long title fits
 * large); body & UI = Archivo. Family names are the per-weight keys loaded by
 * `useFonts` in the root layout — RN bakes the weight into the family, so set
 * `fontFamily` (not `fontWeight`) when using these.
 */
export const Type = {
  display: 'LeagueGothic_400Regular',
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

export const MaxContentWidth = 800;
