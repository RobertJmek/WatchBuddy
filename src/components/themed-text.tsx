import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Accent, Fonts, ThemeColor, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'small'
    | 'smallBold'
    | 'subtitle'
    | 'meta'
    | 'link'
    | 'linkPrimary'
    | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'meta' && styles.meta,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  // --- body & UI: Archivo ---
  default: {
    fontFamily: Type.body,
    fontSize: 16,
    lineHeight: 24,
  },
  small: {
    fontFamily: Type.body,
    fontSize: 14,
    lineHeight: 20,
  },
  smallBold: {
    fontFamily: Type.semibold,
    fontSize: 14,
    lineHeight: 20,
  },
  // Letter-spaced small caps — the "2024 · 166 MIN · SCI-FI" metadata + eyebrows.
  meta: {
    fontFamily: Type.semibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  // --- display: Bodoni Moda (tall figures need ~1.3x line height or iOS clips) ---
  title: {
    fontFamily: Type.display,
    fontSize: 44,
    lineHeight: 58,
  },
  subtitle: {
    fontFamily: Type.displaySemi,
    fontSize: 26,
    lineHeight: 36,
  },
  link: {
    fontFamily: Type.medium,
    fontSize: 14,
    lineHeight: 30,
  },
  linkPrimary: {
    fontFamily: Type.medium,
    fontSize: 14,
    lineHeight: 30,
    color: Accent,
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
