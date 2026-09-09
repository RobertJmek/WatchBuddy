import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, PlaceholderBg } from '@/constants/theme';

/**
 * A person's picture, or a circle with the first letter of their name when
 * there isn't one. Every screen that shows a person renders this — the nine
 * hand-rolled copies it replaced only ever differed by size.
 *
 * `name` may arrive with a leading `@`; the handle's first *letter* is what
 * belongs in the circle, so it's stripped before the initial is taken.
 */
export function Avatar({
  uri,
  name,
  size = 36,
}: {
  uri?: string | null;
  name?: string | null;
  size?: number;
}) {
  const dim = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return (
      <Image
        style={[styles.avatar, dim]}
        source={{ uri }}
        contentFit="cover"
        transition={150}
      />
    );
  }

  const initial = (name ?? '').replace('@', '').trim().charAt(0).toUpperCase() || '?';
  // Scaled off the circle so one component covers 32px reply avatars and 96px
  // profile headers alike, at the proportion every call site had picked by eye.
  const fontSize = Math.round(size * 0.41);

  return (
    <View style={[styles.avatar, styles.fallback, dim]}>
      <ThemedText style={[styles.initial, { fontSize, lineHeight: Math.round(fontSize * 1.25) }]}>
        {initial}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: PlaceholderBg },
  fallback: { backgroundColor: Accent, alignItems: 'center', justifyContent: 'center' },
  initial: { color: AccentText, fontWeight: '700' },
});
