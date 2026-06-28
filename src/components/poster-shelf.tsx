import { Image } from 'expo-image';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
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
    <Pressable style={styles.card} onPress={onPress}>
      <Image
        style={styles.cardPoster}
        source={{ uri: imageUrl(posterPath, 'w342') ?? undefined }}
        contentFit="cover"
        transition={150}
      />
    </Pressable>
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
    <View style={styles.shelf}>
      {onPressHeader ? (
        <Pressable
          style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
          onPress={onPressHeader}>
          <ThemedText type="subtitle">{title}</ThemedText>
          <View style={styles.headerRight}>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              {items.length}
            </ThemedText>
            <ThemedText style={styles.chevron}>›</ThemedText>
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
    </View>
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
  chevron: { color: Accent, fontSize: 22, fontWeight: '600' },
  row: { gap: Spacing.two, paddingRight: Spacing.three },
  card: { width: 110 },
  cardPoster: {
    width: 110,
    height: 165,
    borderRadius: Spacing.one,
    backgroundColor: '#0002',
  },
});
