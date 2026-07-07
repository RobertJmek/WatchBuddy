import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { RowSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UserRow } from '@/components/user-row';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getFollowing } from '@/lib/social';

export default function FollowingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useTheme();
  const { data, isLoading } = useQuery({
    queryKey: ['following', id],
    queryFn: () => getFollowing(id),
  });

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Following' }} />
      {isLoading ? (
        <View style={{ padding: Spacing.three, gap: Spacing.two }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(u) => u.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
              Not following anyone yet.
            </ThemedText>
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
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
