import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { ReviewRow } from '@/components/review-row';
import { RowSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { entityTypeFor, getTitleRatings } from '@/lib/ratings';
import type { MediaType } from '@/lib/tmdb';

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
          data={data?.reviews ?? []}
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
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
