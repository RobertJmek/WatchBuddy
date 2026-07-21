import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { RowSkeleton } from '@/components/skeleton';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { UserRow } from '@/components/user-row';
import { getReviewLikers } from '@/lib/ratings';

/**
 * "Liked by" list for a review. Mounted by two routes (root
 * /review/[ratingId]/likes and Library-nested /thread/[ratingId]/likes) so it
 * inherits whichever navigator opened the thread — see ADR 0005.
 */
export function ReviewLikes({ ratingId }: { ratingId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reviewLikers', ratingId],
    queryFn: () => getReviewLikers(ratingId),
  });

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Liked by' }} />
      {isLoading ? (
        <View style={{ padding: Spacing.three, gap: Spacing.two }}>
          {[0, 1, 2].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(u) => u.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState icon="heart" title="No likes yet" />
          }
          renderItem={({ item }) => <UserRow user={item} />}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.two },
});
