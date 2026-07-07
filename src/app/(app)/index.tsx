import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/icon-symbol';
import { PosterShelf, type PosterItem } from '@/components/poster-shelf';
import { ShelfSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { getLibrary, LIBRARY_STATUSES, type LibraryEntry } from '@/lib/library';

function toPosterItem(e: LibraryEntry): PosterItem | null {
  if (!e.title) return null;
  return {
    key: e.id,
    tmdb_id: e.title.tmdb_id,
    media_type: e.title.media_type,
    title: e.title.title,
    poster_path: e.title.poster_path,
  };
}

function shelfItems(
  entries: LibraryEntry[],
  predicate: (e: LibraryEntry) => boolean,
) {
  return entries
    .filter(predicate)
    .map(toPosterItem)
    .filter((i): i is PosterItem => i !== null);
}

export default function LibraryScreen() {
  const router = useRouter();
  const c = useTheme();
  const {
    data: entries = [],
    isLoading: loading,
    error,
    refetch,
  } = useQuery({ queryKey: ['library'], queryFn: getLibrary });

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const term = useDebouncedValue(query.trim().toLowerCase(), 250);

  function toggleSearch() {
    if (searching) setQuery('');
    setSearching(!searching);
  }

  // Refresh when the tab regains focus (e.g. after adding from Search).
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  // Search narrows every shelf at once; shelves with no matches self-hide below.
  const visible = term
    ? entries.filter((e) => e.title?.title.toLowerCase().includes(term))
    : entries;

  // One shelf per status (canonical order), then favorites split by media type.
  const statusShelves = LIBRARY_STATUSES.map(({ value, label }) => ({
    key: `status-${value}`,
    label,
    params: { status: value, label },
    items: shelfItems(visible, (e) => e.status === value),
  }));

  const favoriteShelves = [
    { key: 'fav-movie', label: 'Favorite Movies', type: 'movie' as const },
    { key: 'fav-tv', label: 'Favorite TV', type: 'tv' as const },
  ].map(({ key, label, type }) => ({
    key,
    label,
    params: { favorite: type, label },
    items: shelfItems(
      visible,
      (e) => e.is_favorite && e.title?.media_type === type,
    ),
  }));

  const shelves = [...statusShelves, ...favoriteShelves].filter(
    (s) => s.items.length > 0,
  );

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
        <ThemedText type="meta" style={[styles.eyebrow, { color: c.textSecondary }]}>
          {(() => {
            const n = entries.filter((e) => e.title).length;
            return `${n} ${n === 1 ? 'Title' : 'Titles'}`;
          })()}
        </ThemedText>
        <View style={styles.headingRow}>
          <ThemedText type="title" style={styles.heading}>
            Library
          </ThemedText>
          <Pressable onPress={toggleSearch} hitSlop={8} style={styles.searchBtn}>
            <IconSymbol
              name={searching ? 'xmark' : 'magnifyingglass'}
              size={22}
              tintColor={c.textSecondary}
            />
          </Pressable>
        </View>

        {searching && (
          <TextInput
            style={[styles.input, { color: c.text, backgroundColor: c.backgroundElement }]}
            placeholder="Search your library"
            placeholderTextColor={c.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            value={query}
            onChangeText={setQuery}
          />
        )}

        {loading ? (
          <ScrollView contentContainerStyle={styles.list} scrollEnabled={false}>
            <ShelfSkeleton />
            <ShelfSkeleton />
            <ShelfSkeleton />
          </ScrollView>
        ) : error ? (
          <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
            Couldn&apos;t load your library. Pull to refresh, or sign out and
            back in.
          </ThemedText>
        ) : shelves.length === 0 ? (
          <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
            {term
              ? `No titles match “${query.trim()}”.`
              : 'Nothing yet. Find something in Search and set a status.'}
          </ThemedText>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {shelves.map((s) => (
              <PosterShelf
                key={s.key}
                title={s.label}
                items={s.items}
                onPressItem={openTitle}
                onPressHeader={() =>
                  router.push({ pathname: '/library-section', params: s.params })
                }
              />
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  eyebrow: { marginTop: Spacing.three },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { marginTop: Spacing.half, marginBottom: Spacing.two },
  searchBtn: { padding: Spacing.half },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    marginBottom: Spacing.two,
    fontSize: 16,
  },
  list: { gap: Spacing.four, paddingVertical: Spacing.two },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
