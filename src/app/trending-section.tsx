import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { PressScale } from '@/components/press-scale';
import { GridSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  getTrendingPage,
  imageUrl,
  type MediaType,
  type SearchResult,
} from '@/lib/tmdb';

const COLS = 3;
const GAP = Spacing.two;
const PAD = Spacing.three;

// TMDB's trending list runs to hundreds of pages, but "trending" stops meaning
// anything a few hundred titles down. Cap the scroll rather than let it run.
const MAX_PAGES = 10;

/**
 * The whole of one trending feed as a grid — what a Search shelf's header opens.
 *
 * Sibling to `library-section`, not a generalisation of it: that screen filters
 * the `['library']` cache client-side and carries the filter sheet, while this
 * one pages a remote feed and has nothing to filter.
 */
export default function TrendingSectionScreen() {
  const router = useRouter();
  const c = useTheme();
  const { type, label } = useLocalSearchParams<{
    type?: MediaType;
    label?: string;
  }>();
  const mediaType: MediaType = type === 'tv' ? 'tv' : 'movie';
  const { width } = useWindowDimensions();
  const cardW = (width - PAD * 2 - GAP * (COLS - 1)) / COLS;

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      // The '1' is the response shape, not the feed. Pages fetched from a proxy
      // that predated pagination were shapeless and got persisted; orphaning
      // that key is how an already-poisoned cache recovers without a reinstall.
      queryKey: ['trendingPage', 1, mediaType],
      queryFn: ({ pageParam }) => getTrendingPage(mediaType, pageParam),
      initialPageParam: 1,
      getNextPageParam: (last) =>
        last.page < Math.min(last.totalPages, MAX_PAGES) ? last.page + 1 : undefined,
      staleTime: 1000 * 60 * 60 * 24, // 24h — same as the shelves' weekly feed.
    });

  // TMDB occasionally repeats a title across pages; two identical keys crash
  // the list's reconciliation, so dedupe on the key we render by.
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: SearchResult[] = [];
    for (const r of data?.pages.flatMap((p) => p.results) ?? []) {
      const key = `${r.media_type}-${r.tmdb_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [data]);

  const renderItem = useCallback(
    ({ item }: { item: SearchResult }) => (
      <PressScale
        style={{ width: cardW }}
        onPress={() =>
          router.push({
            pathname: '/title/[id]',
            params: {
              id: String(item.tmdb_id),
              type: item.media_type,
              name: item.title,
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
          source={{ uri: imageUrl(item.poster_path, 'w342') ?? undefined }}
          contentFit="cover"
          transition={150}
        />
      </PressScale>
    ),
    [cardW, router],
  );

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: label ?? (mediaType === 'tv' ? 'Trending TV' : 'Trending Movies'),
        }}
      />

      {isLoading ? (
        <GridSkeleton rows={4} />
      ) : error && items.length === 0 ? (
        <EmptyState
          icon="film"
          title="Couldn't load trending"
          hint="The movie database seems unreachable. Try again in a bit."
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => `${r.media_type}-${r.tmdb_id}`}
          numColumns={COLS}
          contentContainerStyle={styles.list}
          columnWrapperStyle={styles.col}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.footer}>
                <ActivityIndicator />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
              Nothing trending right now.
            </ThemedText>
          }
          renderItem={renderItem}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: PAD, gap: GAP },
  col: { gap: GAP },
  footer: { paddingVertical: Spacing.three },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
