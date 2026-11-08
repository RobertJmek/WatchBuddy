import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'small'
    | 'smallBold'
    | 'label'
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
        type === 'label' && styles.label,
        type === 'subtitle' && styles.subtitle,
        type === 'meta' && styles.meta,
        type === 'link' && styles.link,
        type === 'linkPrimary' && [styles.linkPrimary, { color: theme.tint }],
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
  // A Step's label and a tappable row's text (ADR 0030).
  label: {
    fontFamily: Type.semibold,
    fontSize: 17,
    lineHeight: 24,
  },
  // Small semibold metadata: counts, field captions. Sentence case since ADR 0030,
  // which dropped the uppercase + letter-spacing.
  meta: {
    fontFamily: Type.semibold,
    fontSize: 12,
    lineHeight: 16,
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
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
