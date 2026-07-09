import { Image } from 'expo-image';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { IconSymbol } from '@/components/icon-symbol';
import { PressScale } from '@/components/press-scale';
import { ThemedText } from '@/components/themed-text';
import { Accent, PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { imageUrl } from '@/lib/tmdb';

export type PosterItem = {
  key: string;
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string;
  poster_path: string | null;
};

export function PosterCard({
  posterPath,
  onPress,
}: {
  posterPath: string | null;
  onPress: () => void;
}) {
  return (
    <PressScale style={styles.card} onPress={onPress}>
      <Image
        style={styles.cardPoster}
        source={{ uri: imageUrl(posterPath, 'w342') ?? undefined }}
        contentFit="cover"
        transition={150}
      />
    </PressScale>
  );
}

/**
 * A titled horizontal row of poster cards. When `onPressHeader` is provided the
 * header becomes a button (label · count · chevron) that, e.g., expands the
 * section; otherwise it's a plain label.
 */
export function PosterShelf({
  title,
  items,
  onPressItem,
  onPressHeader,
}: {
  title: string;
  items: PosterItem[];
  onPressItem: (item: PosterItem) => void;
  onPressHeader?: () => void;
}) {
  const c = useTheme();
  if (items.length === 0) return null;

  return (
    <Animated.View entering={FadeIn.duration(250)} style={styles.shelf}>
      {onPressHeader ? (
        <Pressable
          style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
          onPress={onPressHeader}>
          <ThemedText type="subtitle">{title}</ThemedText>
          <View style={styles.headerRight}>
            <ThemedText type="meta" style={{ color: c.textSecondary }}>
              {items.length}
            </ThemedText>
            <IconSymbol name="chevron.right" size={18} tintColor={c.tint} />
          </View>
        </Pressable>
      ) : (
        <ThemedText type="subtitle" style={styles.headerLabel}>
          {title}
        </ThemedText>
      )}
      <FlatList
        data={items}
        horizontal
        keyExtractor={(i) => i.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        renderItem={({ item }) => (
          <PosterCard
            posterPath={item.poster_path}
            onPress={() => onPressItem(item)}
          />
        )}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shelf: { gap: Spacing.two },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLabel: {},
  pressed: { opacity: 0.6 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  row: { gap: Spacing.two, paddingRight: Spacing.three },
  card: { width: 110 },
  cardPoster: {
    width: 110,
    height: 165,
    borderRadius: 4,
    backgroundColor: PlaceholderBg,
    // a thin dark frame reads as a film plate on both themes
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.35)',
  },
});
