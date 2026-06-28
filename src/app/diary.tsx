import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { imageUrl } from '@/lib/tmdb';
import { getDiary } from '@/lib/watches';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function DiaryScreen() {
  const router = useRouter();
  const {
    data: entries = [],
    isLoading: loading,
    refetch,
  } = useQuery({ queryKey: ['diary'], queryFn: () => getDiary() });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Diary' }} />
      {loading ? (
        <ActivityIndicator style={{ marginTop: Spacing.five }} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <ThemedText style={styles.empty}>
              No watch history yet. Tick off episodes or log a movie.
            </ThemedText>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() =>
                router.push({
                  pathname: '/title/[id]',
                  params: {
                    id: String(item.tmdbId),
                    type: item.mediaType,
                    name: item.titleName,
                  },
                })
              }>
              <Image
                style={styles.poster}
                source={{ uri: imageUrl(item.posterPath, 'w185') ?? undefined }}
                contentFit="cover"
                transition={150}
              />
              <ThemedView style={styles.rowText}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {item.titleName}
                </ThemedText>
                {item.subtitle && (
                  <ThemedText type="small" numberOfLines={1}>
                    {item.subtitle}
                  </ThemedText>
                )}
                <ThemedText type="small" style={styles.date}>
                  {formatDate(item.watched_at)}
                </ThemedText>
              </ThemedView>
            </Pressable>
          )}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  poster: {
    width: 44,
    height: 66,
    borderRadius: Spacing.one,
    backgroundColor: '#0002',
  },
  rowText: { flex: 1, gap: Spacing.half, backgroundColor: 'transparent' },
  date: { opacity: 0.6 },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
