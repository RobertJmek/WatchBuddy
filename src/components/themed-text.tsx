import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'small'
    | 'smallBold'
    | 'subtitle'
    | 'label'
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
        type === 'label' && styles.label,
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
  // A row or field label: names the thing, in the UI face.
  label: {
    fontFamily: Type.semibold,
    fontSize: 17,
    lineHeight: 24,
  },
  // The "2024 · 166 MIN · SCI-FI" metadata line.
  meta: {
    fontFamily: Type.semibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  // --- display: Archivo ExtraBold, set tight ---
  title: {
    fontFamily: Type.display,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -1,
  },
  subtitle: {
    fontFamily: Type.display,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.4,
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
