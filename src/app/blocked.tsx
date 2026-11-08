import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { Intro } from '@/components/intro';
import { RowSkeletonList } from '@/components/skeleton';
import { ThemedView } from '@/components/themed-view';
import { UserRow } from '@/components/user-row';
import { Spacing } from '@/constants/theme';
import { keys } from '@/lib/keys';
import { getBlockedUsers } from '@/lib/moderation';
import { useBottomGap } from '@/hooks/use-bottom-gap';

/**
 * The people you have blocked, each with an Unblock pill. Reached from Edit
 * profile. Opening a row goes to their profile, which also offers Unblock.
 */
export default function BlockedAccountsScreen() {
  const bottomGap = useBottomGap();
  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: keys.blockedUsers(),
    queryFn: getBlockedUsers,
  });

  const intro = (
    <Intro
      title="Blocked accounts"
      body="People you block can't see your reviews or activity, and you can't see theirs."
    />
  );

  return (
    <ThemedView style={styles.container}>
      {/* No header title: the Intro is the title (ADR 0030). */}
      <Stack.Screen options={{ headerShown: true, title: '' }} />
      {isLoading ? (
        <>
          <View style={styles.head}>{intro}</View>
          <RowSkeletonList />
        </>
      ) : isError ? (
        // Never let a failed load read as "No blocked accounts" — you may have some.
        <View style={styles.error}>
          <View style={styles.head}>{intro}</View>
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
          contentContainerStyle={[styles.list, { paddingBottom: bottomGap }]}
          ListHeaderComponent={<View style={styles.listHead}>{intro}</View>}
          ListEmptyComponent={
            <EmptyState
              icon="person.2"
              title="No blocked accounts"
              hint="You can block someone from their profile."
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
  // The tutorial-card measures: 24pt sides, 32 below the Intro.
  head: { alignSelf: 'stretch', paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  list: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, gap: Spacing.two, flexGrow: 1 },
  listHead: { paddingBottom: Spacing.five - Spacing.two },
  error: { alignItems: 'center', gap: Spacing.three },
  retryBtn: { paddingHorizontal: Spacing.five },
});
