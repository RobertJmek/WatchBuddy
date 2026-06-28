import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  getLibrary,
  LIBRARY_STATUSES,
  type LibraryStatus,
} from '@/lib/library';
import { imageUrl } from '@/lib/tmdb';

const STATUS_LABEL = Object.fromEntries(
  LIBRARY_STATUSES.map((s) => [s.value, s.label]),
) as Record<LibraryStatus, string>;

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

  // Group into sections following the canonical status order.
  const statusSections = LIBRARY_STATUSES.map(({ value }) => ({
    title: STATUS_LABEL[value],
    data: entries.filter((e) => e.status === value),
  })).filter((s) => s.data.length > 0);

  // Favorites at the bottom, split by media type. A favorited title also shows
  // under its status above, so prefix the id to keep SectionList keys unique.
  const favoriteSections = [
    { title: 'Favorite Movies', type: 'movie' as const },
    { title: 'Favorite TV', type: 'tv' as const },
  ]
    .map(({ title, type }) => ({
      title,
      data: entries
        .filter((e) => e.is_favorite && e.title?.media_type === type)
        .map((e) => ({ ...e, id: `fav-${e.id}` })),
    }))
    .filter((s) => s.data.length > 0);

  const sections = [...statusSections, ...favoriteSections];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedText type="title" style={styles.heading}>
          Library
        </ThemedText>

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.four }} />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            stickySectionHeadersEnabled={false}
            ListEmptyComponent={
              <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
                Nothing yet. Find something in Search and set a status.
              </ThemedText>
            }
            renderSectionHeader={({ section }) => (
              <ThemedText type="subtitle" style={styles.sectionHeader}>
                {section.title}
              </ThemedText>
            )}
            renderItem={({ item }) =>
              item.title ? (
                <Pressable
                  style={[styles.row, { backgroundColor: c.backgroundElement }]}
                  onPress={() =>
                    router.push({
                      pathname: '/title/[id]',
                      params: {
                        id: String(item.title!.tmdb_id),
                        type: item.title!.media_type,
                        name: item.title!.title,
                      },
                    })
                  }>
                  <Image
                    style={styles.poster}
                    source={{
                      uri: imageUrl(item.title.poster_path, 'w185') ?? undefined,
                    }}
                    contentFit="cover"
                    transition={150}
                  />
                  <ThemedView style={styles.rowText}>
                    <ThemedText type="smallBold" numberOfLines={2}>
                      {item.title.title}
                    </ThemedText>
                    <ThemedText type="small">
                      {item.title.media_type === 'tv' ? 'TV' : 'Movie'}
                      {item.title.release_date
                        ? ` · ${item.title.release_date.slice(0, 4)}`
                        : ''}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              ) : null
            }
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  heading: { marginTop: Spacing.three },
  list: { paddingVertical: Spacing.two, gap: Spacing.two },
  sectionHeader: { marginTop: Spacing.three, marginBottom: Spacing.two },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
    padding: Spacing.two,
    borderRadius: Spacing.three,
  },
  poster: {
    width: 48,
    height: 72,
    borderRadius: Spacing.one,
    backgroundColor: '#0002',
  },
  rowText: { flex: 1, gap: Spacing.half, backgroundColor: 'transparent' },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
