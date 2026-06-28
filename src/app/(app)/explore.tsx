import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Danger, Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { imageUrl, searchTitles, type SearchResult } from '@/lib/tmdb';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 500;

export default function SearchScreen() {
  const router = useRouter();
  const c = useTheme();

  const [query, setQuery] = useState('');
  const term = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const enabled = term.length >= MIN_CHARS;

  const {
    data: results = [],
    isFetching,
    error,
  } = useQuery({
    queryKey: ['search', term],
    queryFn: () => searchTitles(term),
    enabled,
    placeholderData: keepPreviousData,
  });

  function year(r: SearchResult) {
    return r.release_date ? r.release_date.slice(0, 4) : '—';
  }

  // Below the threshold we never show stale results — just a hint.
  const showHint = !enabled;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedText type="title" style={styles.heading}>
          Search
        </ThemedText>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { color: c.text, backgroundColor: c.backgroundElement }]}
            placeholder="Movies & TV…"
            placeholderTextColor={c.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            value={query}
            onChangeText={setQuery}
          />
          {enabled && isFetching && (
            <ActivityIndicator style={styles.inputSpinner} />
          )}
        </View>

        {error && <ThemedText style={styles.error}>{String(error)}</ThemedText>}

        {showHint ? (
          <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
            Type at least {MIN_CHARS} characters to search.
          </ThemedText>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(r) => `${r.media_type}-${r.tmdb_id}`}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            // Dim (don't blank) while a newer query is loading.
            style={isFetching ? styles.dimmed : undefined}
            ListEmptyComponent={
              !isFetching ? (
                <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
                  No results.
                </ThemedText>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                style={[styles.row, { backgroundColor: c.backgroundElement }]}
                onPress={() =>
                  router.push({
                    pathname: '/title/[id]',
                    params: {
                      id: String(item.tmdb_id),
                      type: item.media_type,
                      name: item.title,
                    },
                  })
                }>
                <Image
                  style={styles.poster}
                  source={{ uri: imageUrl(item.poster_path, 'w185') ?? undefined }}
                  contentFit="cover"
                  transition={150}
                />
                <ThemedView style={styles.rowText}>
                  <ThemedText type="smallBold" numberOfLines={2}>
                    {item.title}
                  </ThemedText>
                  <ThemedText type="small">
                    {item.media_type === 'tv' ? 'TV' : 'Movie'} · {year(item)}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  heading: { marginTop: Spacing.three, marginBottom: Spacing.two },
  inputRow: { justifyContent: 'center' },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  inputSpinner: { position: 'absolute', right: Spacing.three },
  dimmed: { opacity: 0.4 },
  list: { gap: Spacing.two, paddingVertical: Spacing.three },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
    padding: Spacing.two,
    borderRadius: Spacing.three,
  },
  poster: {
    width: 52,
    height: 78,
    borderRadius: Spacing.one,
    backgroundColor: '#0002',
  },
  rowText: { flex: 1, gap: Spacing.half, backgroundColor: 'transparent' },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  error: { color: Danger, marginTop: Spacing.three },
});
