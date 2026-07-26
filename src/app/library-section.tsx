import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { FilterChips } from '@/components/filter-chips';
import { IconSymbol } from '@/components/icon-symbol';
import { LibraryFilterSheet } from '@/components/library-filter-sheet';
import { PressScale } from '@/components/press-scale';
import { GridSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getGenres } from '@/lib/genres';
import { getLibrary, type LibraryStatus } from '@/lib/library';
import {
  applyFilter,
  EMPTY_FILTER,
  filterFromParams,
  isActive,
  yearBounds,
} from '@/lib/library-filter';
import { imageUrl } from '@/lib/tmdb';

const COLS = 3;
const GAP = Spacing.two;
const PAD = Spacing.three;

export default function LibrarySectionScreen() {
  const router = useRouter();
  const c = useTheme();
  const params = useLocalSearchParams<{
    status?: LibraryStatus;
    favorite?: string;
    label?: string;
    type?: string;
    genres?: string;
    years?: string;
    rating?: string;
  }>();
  const { status, favorite, label } = params;
  const { width } = useWindowDimensions();
  const cardW = (width - PAD * 2 - GAP * (COLS - 1)) / COLS;

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['library'],
    queryFn: getLibrary,
  });
  const { data: genres = [] } = useQuery({
    queryKey: ['genres'],
    queryFn: getGenres,
    staleTime: Infinity,
  });

  // Whatever was filtered on Library arrives as params and seeds this screen.
  // From here the two are independent: editing the filter here never writes
  // back, so Back leaves Library exactly as it was.
  const [filter, setFilter] = useState(() => filterFromParams(params));
  const [filterOpen, setFilterOpen] = useState(false);
  const filtered = isActive(filter);

  // A section is either a status group or the favorites group.
  const inSection = entries.filter((e) => {
    if (!e.title) return false;
    if (favorite) return e.is_favorite;
    return e.status === status;
  });
  const items = applyFilter(inSection, filter);

  const genreNames = new Map(genres.map((g) => [g.id, g.name]));
  const availableGenreIds = new Set(entries.flatMap((e) => e.genreIds));

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: label ?? 'Library',
          headerRight: () => (
            <Pressable onPress={() => setFilterOpen(true)} hitSlop={8}>
              <IconSymbol
                name="line.3.horizontal.decrease"
                size={22}
                tintColor={filtered ? c.tint : c.textSecondary}
              />
            </Pressable>
          ),
        }}
      />

      <LibraryFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filter={filter}
        onApply={setFilter}
        genres={genres}
        availableGenreIds={availableGenreIds}
        yearDomain={yearBounds(entries)}
      />

      {isLoading ? (
        <GridSkeleton rows={4} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e) => e.id}
          numColumns={COLS}
          contentContainerStyle={styles.list}
          columnWrapperStyle={styles.col}
          ListHeaderComponent={
            filtered ? (
              <View style={styles.chipHeader}>
                <FilterChips
                  filter={filter}
                  genreNames={genreNames}
                  onChange={setFilter}
                />
              </View>
            ) : null
          }
          ListEmptyComponent={
            // Two very different dead ends: an empty category, or a filter that
            // matched nothing. With genres ANDed, the second one is routine.
            filtered ? (
              <View style={styles.emptyBlock}>
                <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
                  {inSection.length === 0
                    ? 'Nothing here yet.'
                    : 'No titles here match your filter.'}
                </ThemedText>
                <Pressable
                  onPress={() => setFilter(EMPTY_FILTER)}
                  hitSlop={8}
                  style={styles.clear}>
                  <ThemedText type="smallBold" style={{ color: c.tint }}>
                    Clear filter
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
                Nothing here yet.
              </ThemedText>
            )
          }
          renderItem={({ item }) => (
            <PressScale
              style={{ width: cardW }}
              onPress={() =>
                router.push({
                  pathname: '/title/[id]',
                  params: {
                    id: String(item.title!.tmdb_id),
                    type: item.title!.media_type,
                    name: item.title!.title,
                  },
                })
              }>
              <Image
                style={{
                  width: cardW,
                  height: cardW * 1.5,
                  borderRadius: 4,
                  backgroundColor: PlaceholderBg,
                  borderWidth: 1,
                  borderColor: 'rgba(0,0,0,0.35)',
                }}
                source={{ uri: imageUrl(item.title!.poster_path, 'w342') ?? undefined }}
                contentFit="cover"
                transition={150}
              />
            </PressScale>
          )}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: PAD, gap: GAP },
  col: { gap: GAP },
  chipHeader: { paddingBottom: Spacing.two },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  emptyBlock: { alignItems: 'center', gap: Spacing.two },
  clear: { padding: Spacing.two },
});
