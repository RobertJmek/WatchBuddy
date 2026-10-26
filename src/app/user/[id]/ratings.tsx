import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { GridPoster } from '@/components/grid-poster';
import { RatedReviewRow } from '@/components/rated-review-row';
import { SegmentedControl, type Segment } from '@/components/segmented-control';
import { GridSkeleton, RowSkeletonList } from '@/components/skeleton';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { keys } from '@/lib/keys';
import { getUserRatings, type RatingsSort, type UserRating } from '@/lib/ratings';

const COLS = 3;
const GAP = Spacing.two;
const PAD = Spacing.three;
const PAGE = 30;

const SORTS: Segment<RatingsSort>[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'highest', label: 'Highest' },
  { key: 'lowest', label: 'Lowest' },
];

/**
 * Everything one person rated (`kind=ratings`, a poster grid with their score
 * on each) or wrote a review for (`kind=reviews`, a list) — what the two
 * headers on their profile open. ADR 0026.
 */
export default function UserRatingsScreen() {
  const { id, kind: kindParam } = useLocalSearchParams<{ id: string; kind?: string }>();
  const kind = kindParam === 'reviews' ? 'reviews' : 'ratings';
  const [sort, setSort] = useState<RatingsSort>('recent');
  const { width } = useWindowDimensions();
  const cardW = (width - PAD * 2 - GAP * (COLS - 1)) / COLS;

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: keys.ratingsBy(id, kind, sort, 'all'),
      queryFn: ({ pageParam }) =>
        getUserRatings(id, {
          reviewsOnly: kind === 'reviews',
          sort,
          offset: pageParam,
          limit: PAGE,
        }),
      initialPageParam: 0,
      getNextPageParam: (last, pages) => {
        const next = pages.length * PAGE;
        return next < last.total ? next : undefined;
      },
    });

  // Offset paging: a rating changed between two pages shifts the rows under
  // it, so a row can repeat (deduped here — two identical keys crash the list)
  // or be skipped until the next refetch. Fine for a person's own ratings.
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (data?.pages.flatMap((p) => p.items) ?? []).filter((r) =>
      seen.has(r.ratingId) ? false : (seen.add(r.ratingId), true),
    );
  }, [data]);

  const renderItem = useCallback(
    ({ item }: { item: UserRating }) =>
      kind === 'reviews' ? (
        <RatedReviewRow item={item} />
      ) : (
        <GridPoster
          width={cardW}
          tmdbId={item.title.tmdb_id}
          mediaType={item.title.media_type}
          name={item.title.title}
          posterPath={item.title.poster_path}
          score={item.value}
        />
      ),
    [kind, cardW],
  );

  const title = kind === 'reviews' ? 'Reviews' : 'Ratings';
  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title }} />
      <View style={styles.sort}>
        <SegmentedControl segments={SORTS} value={sort} onChange={setSort} />
      </View>

      {isLoading ? (
        kind === 'reviews' ? <RowSkeletonList /> : <GridSkeleton rows={4} />
      ) : error && items.length === 0 ? (
        <EmptyState
          icon={kind === 'reviews' ? 'bubble' : 'film'}
          title={`Couldn't load ${title.toLowerCase()}`}
          hint="Check your connection and try again."
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={kind === 'reviews' ? 'bubble' : 'film'}
          title={kind === 'reviews' ? 'No reviews yet' : 'No ratings yet'}
        />
      ) : (
        <FlatList
          // numColumns can't change on a mounted list; the key remounts it.
          key={kind}
          data={items}
          keyExtractor={(r) => r.ratingId}
          numColumns={kind === 'reviews' ? 1 : COLS}
          contentContainerStyle={styles.list}
          columnWrapperStyle={kind === 'reviews' ? undefined : styles.col}
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
          renderItem={renderItem}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sort: { paddingHorizontal: PAD, paddingTop: Spacing.two },
  list: { padding: PAD, gap: GAP },
  col: { gap: GAP },
  footer: { paddingVertical: Spacing.three },
});
