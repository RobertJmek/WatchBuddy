import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PosterShelf, type PosterItem } from '@/components/poster-shelf';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
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
    refetch,
  } = useQuery({ queryKey: ['library'], queryFn: getLibrary });

  // Refresh when the tab regains focus (e.g. after adding from Search).
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  // One shelf per status (canonical order), then favorites split by media type.
  const statusShelves = LIBRARY_STATUSES.map(({ value, label }) => ({
    key: `status-${value}`,
    label,
    params: { status: value, label },
    items: shelfItems(entries, (e) => e.status === value),
  }));

  const favoriteShelves = [
    { key: 'fav-movie', label: 'Favorite Movies', type: 'movie' as const },
    { key: 'fav-tv', label: 'Favorite TV', type: 'tv' as const },
  ].map(({ key, label, type }) => ({
    key,
    label,
    params: { favorite: type, label },
    items: shelfItems(
      entries,
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
        <ThemedText type="title" style={styles.heading}>
          Library
        </ThemedText>

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.four }} />
        ) : shelves.length === 0 ? (
          <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
            Nothing yet. Find something in Search and set a status.
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
  heading: { marginTop: Spacing.three, marginBottom: Spacing.two },
  list: { gap: Spacing.four, paddingVertical: Spacing.two },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
