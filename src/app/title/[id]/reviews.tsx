import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ReviewRow } from '@/components/review-row';
import { RowSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  entityTypeFor,
  getTitleRatings,
  sortReviews,
  type ReviewSort,
} from '@/lib/ratings';
import type { MediaType } from '@/lib/tmdb';

const SORTS: { value: ReviewSort; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'recent', label: 'Recent' },
  { value: 'highest', label: 'Highest' },
  { value: 'lowest', label: 'Lowest' },
];

export default function ReviewsScreen() {
  const c = useTheme();
  const { titleId, type } = useLocalSearchParams<{
    id: string;
    titleId: string;
    type: MediaType;
    name?: string;
  }>();

  const { data, isLoading } = useQuery({
    queryKey: ['titleRatings', titleId],
    queryFn: () => getTitleRatings(entityTypeFor(type), titleId),
  });

  const [sort, setSort] = useState<ReviewSort>('top');
  const reviews = useMemo(
    () => sortReviews(data?.reviews ?? [], sort),
    [data?.reviews, sort],
  );

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Reviews' }} />
      {isLoading ? (
        <View style={{ padding: Spacing.three, gap: Spacing.two }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={(r) => r.userId}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            data && data.count > 0 ? (
              <View style={styles.summary}>
                <ThemedText style={[styles.average, { color: c.glow }]}>
                  {data.average.toFixed(1)}
                </ThemedText>
                <ThemedText type="meta" style={{ color: c.textSecondary }}>
                  {data.count} {data.count === 1 ? 'rating' : 'ratings'} ·{' '}
                  {data.reviews.length}{' '}
                  {data.reviews.length === 1 ? 'review' : 'reviews'}
                </ThemedText>
                {data.reviews.length > 1 && (
                  <View style={styles.sortRow}>
                    {SORTS.map(({ value, label }) => {
                      const on = value === sort;
                      return (
                        <Pressable
                          key={value}
                          onPress={() => setSort(value)}
                          style={[
                            styles.sortChip,
                            on
                              ? styles.sortChipOn
                              : { borderColor: c.border },
                          ]}>
                          <ThemedText
                            type="small"
                            style={on ? styles.sortTextOn : undefined}>
                            {label}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
              No written reviews yet.
            </ThemedText>
          }
          renderItem={({ item }) => <ReviewRow review={item} />}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.two },
  summary: { alignItems: 'center', gap: Spacing.half, marginBottom: Spacing.two },
  average: { fontFamily: Type.display, fontSize: 48, lineHeight: 64 },
  sortRow: { flexDirection: 'row', gap: Spacing.one, marginTop: Spacing.two },
  sortChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Accent,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  sortChipOn: { backgroundColor: Accent, borderColor: Accent },
  sortTextOn: { color: AccentText },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
