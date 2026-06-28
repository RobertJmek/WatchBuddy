import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PosterShelf, type PosterItem } from '@/components/poster-shelf';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Danger, Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { getTrending, imageUrl, searchTitles, type SearchResult } from '@/lib/tmdb';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 500;

function year(r: SearchResult) {
  return r.release_date ? r.release_date.slice(0, 4) : '—';
}

function toPosterItem(r: SearchResult): PosterItem {
  return {
    key: `${r.media_type}-${r.tmdb_id}`,
    tmdb_id: r.tmdb_id,
    media_type: r.media_type,
    title: r.title,
    poster_path: r.poster_path,
  };
}

function ResultRow({
  item,
  bg,
  router,
}: {
  item: SearchResult;
  bg: string;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <Pressable
      style={[styles.row, { backgroundColor: bg }]}
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
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const c = useTheme();

  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const term = useDebouncedValue(trimmed, DEBOUNCE_MS);
  const searching = term.length >= MIN_CHARS;

  // empty -> trending feed; 1-2 chars -> hint; 3+ -> live search results.
  const mode: 'trending' | 'hint' | 'search' =
    trimmed.length === 0 ? 'trending' : trimmed.length < MIN_CHARS ? 'hint' : 'search';

  const search = useQuery({
    queryKey: ['search', term],
    queryFn: () => searchTitles(term),
    enabled: searching,
    placeholderData: keepPreviousData,
  });

  const trending = useQuery({
    queryKey: ['trending'],
    queryFn: getTrending,
    staleTime: 1000 * 60 * 60 * 24, // 24h — the weekly feed barely moves.
  });

  function openTitle(item: PosterItem) {
    router.push({
      pathname: '/title/[id]',
      params: {
        id: String(item.tmdb_id),
        type: item.media_type,
        name: item.title,
      },
    });
  }

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
          {mode === 'search' && search.isFetching && (
            <ActivityIndicator style={styles.inputSpinner} />
          )}
        </View>

        {mode === 'search' && search.error && (
          <ThemedText style={styles.error}>{String(search.error)}</ThemedText>
        )}

        {mode === 'hint' && (
          <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
            Type at least {MIN_CHARS} characters to search.
          </ThemedText>
        )}

        {mode === 'search' && (
          <FlatList
            data={search.data ?? []}
            keyExtractor={(r) => `${r.media_type}-${r.tmdb_id}`}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            style={search.isFetching ? styles.dimmed : undefined}
            ListEmptyComponent={
              !search.isFetching ? (
                <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
                  No results.
                </ThemedText>
              ) : null
            }
            renderItem={({ item }) => (
              <ResultRow item={item} bg={c.backgroundElement} router={router} />
            )}
          />
        )}

        {mode === 'trending' &&
          (trending.isLoading ? (
            <ActivityIndicator style={{ marginTop: Spacing.five }} />
          ) : trending.error ? (
            <ThemedText style={styles.error}>{String(trending.error)}</ThemedText>
          ) : (
            <ScrollView
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled">
              <PosterShelf
                title="Trending Movies"
                items={(trending.data?.movies ?? []).map(toPosterItem)}
                onPressItem={openTitle}
              />
              <PosterShelf
                title="Trending TV"
                items={(trending.data?.tv ?? []).map(toPosterItem)}
                onPressItem={openTitle}
              />
            </ScrollView>
          ))}
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
