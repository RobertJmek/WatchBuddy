import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { imageUrl, searchTitles, type SearchResult } from '@/lib/tmdb';

export default function SearchScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const textColor = scheme === 'dark' ? '#fff' : '#000';
  const borderColor = scheme === 'dark' ? '#444' : '#ccc';

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
        <TextInput
          style={[styles.input, { color: textColor, borderColor }]}
          placeholder="Search movies & TV…"
          placeholderTextColor={borderColor}
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
            !loading && searched ? (
              <ThemedText style={styles.empty}>No results.</ThemedText>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
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
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.three,
  },
  list: { gap: Spacing.three, paddingVertical: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  poster: {
    width: 56,
    height: 84,
    borderRadius: Spacing.one,
    backgroundColor: '#0002',
  },
  rowText: { flex: 1, gap: Spacing.half, backgroundColor: 'transparent' },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  error: { color: '#e44', marginTop: Spacing.three },
});
