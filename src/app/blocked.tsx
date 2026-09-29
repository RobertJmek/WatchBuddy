import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { RowSkeletonList } from '@/components/skeleton';
import { ThemedView } from '@/components/themed-view';
import { UserRow } from '@/components/user-row';
import { Spacing } from '@/constants/theme';
import { keys } from '@/lib/keys';
import { getBlockedUsers } from '@/lib/moderation';

/**
 * The people you have blocked, each with an Unblock pill. Reached from Edit
 * profile. Opening a row goes to their profile, which also offers Unblock.
 */
export default function BlockedAccountsScreen() {
  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: keys.blockedUsers(),
    queryFn: getBlockedUsers,
  });

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Blocked accounts' }} />
      {isLoading ? (
        <RowSkeletonList />
      ) : isError ? (
        // Never let a failed load read as "No blocked accounts" — you may have some.
        <View style={styles.error}>
          <EmptyState
            icon="person.2"
            title="Couldn't load your blocked accounts"
            hint="Check your connection and try again."
          />
          <Button
            title="Try again"
            variant="outline"
            style={styles.retryBtn}
            loading={isRefetching}
            onPress={() => void refetch()}
          />
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(u) => u.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="person.2"
              title="No blocked accounts"
              hint="People you block can't see your reviews or activity, and you can't see theirs."
            />
          }
          renderItem={({ item }) => <UserRow user={item} variant="blocked" />}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.two, flexGrow: 1 },
  error: { alignItems: 'center', gap: Spacing.three },
  retryBtn: { paddingHorizontal: Spacing.five },
});
