import { useQuery } from '@tanstack/react-query';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Keyboard, StyleSheet, TextInput, View } from 'react-native';

import { IconSymbol } from '@/components/icon-symbol';
import { Pressable } from '@/components/pressable';
import { RowSkeletonList } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UserRow } from '@/components/user-row';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { keys } from '@/lib/keys';
import { getFollowers, getFollowing, type UserResult } from '@/lib/social';
import { useBottomGap } from '@/hooks/use-bottom-gap';

const LISTS = {
  followers: { title: 'Followers', empty: 'No followers yet.', fetch: getFollowers },
  following: {
    title: 'Following',
    empty: 'Not following anyone yet.',
    fetch: getFollowing,
  },
} as const;

/**
 * Whether a person matches what was typed: anywhere in the username or the
 * display name, ignoring case. The whole list is already on the device, so
 * this filters it rather than asking the server.
 */
function matches(user: UserResult, term: string): boolean {
  return [user.username, user.display_name].some((s) => s?.toLowerCase().includes(term));
}

/** A user's followers or followees — the body of both `user/[id]` list routes. */
export function FollowList({ kind }: { kind: keyof typeof LISTS }) {
  const bottomGap = useBottomGap();
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useTheme();
  const list = LISTS[kind];
  const { data, isLoading } = useQuery({
    queryKey: keys[kind](id),
    queryFn: () => list.fetch(id),
  });
  const [query, setQuery] = useState('');
  useFocusEffect(useCallback(() => () => Keyboard.dismiss(), []));

  const people = data ?? [];
  const term = query.trim().replace(/^@/, '').toLowerCase();
  const shown = term ? people.filter((u) => matches(u, term)) : people;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: list.title }} />
      {isLoading ? (
        <RowSkeletonList />
      ) : (
        <>
          {people.length > 0 && (
            <View style={styles.searchBar}>
              <View style={styles.inputRow}>
                <TextInput
                  style={[
                    styles.input,
                    { color: c.text, backgroundColor: c.backgroundElement },
                  ]}
                  placeholder="Search by name or @username"
                  placeholderTextColor={c.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  value={query}
                  onChangeText={setQuery}
                  accessibilityLabel={`Search ${list.title.toLowerCase()}`}
                />
                {query.length > 0 && (
                  <Pressable
                    style={styles.inputClear}
                    hitSlop={8}
                    onPress={() => setQuery('')}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search">
                    <IconSymbol name="xmark" size={18} tintColor={c.textSecondary} />
                  </Pressable>
                )}
              </View>
            </View>
          )}
          <FlatList
            data={shown}
            keyExtractor={(u) => u.id}
            contentContainerStyle={[styles.list, { paddingBottom: bottomGap }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
            ListEmptyComponent={
              <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
                {term ? `No one matches “${query.trim()}”.` : list.empty}
              </ThemedText>
            }
            renderItem={({ item }) => <UserRow user={item} />}
          />
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBar: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  inputRow: { justifyContent: 'center' },
  input: {
    borderRadius: Spacing.three,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.five + Spacing.two,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  inputClear: { position: 'absolute', right: Spacing.three },
  list: { padding: Spacing.three, gap: Spacing.two },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
