import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UserRow } from '@/components/user-row';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getFollowers } from '@/lib/social';

export default function FollowersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useTheme();
  const { data, isLoading } = useQuery({
    queryKey: ['followers', id],
    queryFn: () => getFollowers(id),
  });

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Followers' }} />
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: Spacing.five }} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(u) => u.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
              No followers yet.
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
