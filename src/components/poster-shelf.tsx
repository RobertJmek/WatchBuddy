import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { memo, useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { IconSymbol } from '@/components/icon-symbol';
import { PressScale } from '@/components/press-scale';
import { ThemedText } from '@/components/themed-text';
import { Accent, PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { imageUrl, titleQueryOptions } from '@/lib/tmdb';

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
  onPressIn,
}: {
  posterPath: string | null;
  onPress: () => void;
  onPressIn?: () => void;
}) {
  return (
    <PressScale style={styles.card} onPress={onPress} onPressIn={onPressIn}>
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
 *
 * Memoized: a screen holding several shelves re-renders for reasons that have
 * nothing to do with them (Library opening its filter sheet is the case that
 * prompted this), and re-rendering every poster of every shelf was showing up
 * as a stutter. Callers that want the saving must keep `items` and the two
 * handlers referentially stable; the ones that don't simply render as before.
 */
export const PosterShelf = memo(function PosterShelf({
  title,
  items,
  onPressItem,
  onPressHeader,
  showCount = true,
}: {
  title: string;
  items: PosterItem[];
  onPressItem: (item: PosterItem) => void;
  onPressHeader?: () => void;
  /**
   * The count next to the header reads as "how many are behind this". That's
   * true for a Library section, but a trending shelf holds one page of a feed
   * that continues past it — there, showing 20 would understate the screen the
   * header opens, so those shelves turn it off.
   */
  showCount?: boolean;
}) {
  const c = useTheme();
  const queryClient = useQueryClient();
  const renderItem = useCallback(
    ({ item }: { item: PosterItem }) => (
      <PosterCard
        posterPath={item.poster_path}
        onPress={() => onPressItem(item)}
        // Warm the detail cache while the finger is still down.
        onPressIn={() =>
          queryClient.prefetchQuery(
            titleQueryOptions(item.tmdb_id, item.media_type),
          )
        }
      />
    ),
    [onPressItem, queryClient],
  );
  if (items.length === 0) return null;

  return (
    <Animated.View entering={FadeIn.duration(250)} style={styles.shelf}>
      {onPressHeader ? (
        <Pressable
          style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
          onPress={onPressHeader}>
          <ThemedText type="subtitle">{title}</ThemedText>
          <View style={styles.headerRight}>
            {showCount && (
              <ThemedText type="meta" style={{ color: c.textSecondary }}>
                {items.length}
              </ThemedText>
            )}
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
        renderItem={renderItem}
      />
    </Animated.View>
  );
});

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
