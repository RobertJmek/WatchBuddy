import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Danger, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { imageUrl, searchTitles, type SearchResult } from '@/lib/tmdb';

export default function SearchScreen() {
  const router = useRouter();
  const c = useTheme();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function runSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await searchTitles(query));
      setSearched(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function year(r: SearchResult) {
    return r.release_date ? r.release_date.slice(0, 4) : '—';
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedText type="title" style={styles.heading}>
          Search
        </ThemedText>
        <TextInput
          style={[styles.input, { color: c.text, backgroundColor: c.backgroundElement }]}
          placeholder="Movies & TV…"
          placeholderTextColor={c.textSecondary}
          autoCapitalize="none"
          returnKeyType="search"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={runSearch}
        />

        {loading && <ActivityIndicator style={{ marginTop: Spacing.three }} />}
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <FlatList
          data={results}
          keyExtractor={(r) => `${r.media_type}-${r.tmdb_id}`}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            !loading ? (
              <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
                {searched ? 'No results.' : 'Find a movie or show to track.'}
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
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  heading: { marginTop: Spacing.three, marginBottom: Spacing.two },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
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
