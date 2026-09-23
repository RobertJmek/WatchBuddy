import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, StyleSheet } from 'react-native';

import { RowSkeletonList } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UserRow } from '@/components/user-row';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { keys } from '@/lib/keys';
import { getFollowers, getFollowing } from '@/lib/social';

const LISTS = {
  followers: { title: 'Followers', empty: 'No followers yet.', fetch: getFollowers },
  following: { title: 'Following', empty: 'Not following anyone yet.', fetch: getFollowing },
} as const;

/** A user's followers or followees — the body of both `user/[id]` list routes. */
export function FollowList({ kind }: { kind: keyof typeof LISTS }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useTheme();
  const list = LISTS[kind];
  const { data, isLoading } = useQuery({
    queryKey: keys[kind](id),
    queryFn: () => list.fetch(id),
  });

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: list.title }} />
      {isLoading ? (
        <RowSkeletonList />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(u) => u.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
              {list.empty}
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
