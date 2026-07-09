import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';

import { PressScale } from '@/components/press-scale';
import { GridSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getLibrary, type LibraryStatus } from '@/lib/library';
import { imageUrl } from '@/lib/tmdb';

const COLS = 3;
const GAP = Spacing.two;
const PAD = Spacing.three;

export default function LibrarySectionScreen() {
  const router = useRouter();
  const c = useTheme();
  const { status, favorite, label } = useLocalSearchParams<{
    status?: LibraryStatus;
    favorite?: 'movie' | 'tv';
    label?: string;
  }>();
  const { width } = useWindowDimensions();
  const cardW = (width - PAD * 2 - GAP * (COLS - 1)) / COLS;

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['library'],
    queryFn: getLibrary,
  });

  // A section is either a status group or a favorites-by-media-type group.
  const items = entries.filter((e) => {
    if (!e.title) return false;
    if (favorite) return e.is_favorite && e.title.media_type === favorite;
    return e.status === status;
  });

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: label ?? 'Library' }} />
      {isLoading ? (
        <GridSkeleton rows={4} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e) => e.id}
          numColumns={COLS}
          contentContainerStyle={styles.list}
          columnWrapperStyle={styles.col}
          ListEmptyComponent={
            <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
              Nothing here yet.
            </ThemedText>
          }
          renderItem={({ item }) => (
            <PressScale
              style={{ width: cardW }}
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
                style={{
                  width: cardW,
                  height: cardW * 1.5,
                  borderRadius: 4,
                  backgroundColor: PlaceholderBg,
                  borderWidth: 1,
                  borderColor: 'rgba(0,0,0,0.35)',
                }}
                source={{ uri: imageUrl(item.title!.poster_path, 'w342') ?? undefined }}
                contentFit="cover"
                transition={150}
              />
            </PressScale>
          )}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: PAD, gap: GAP },
  col: { gap: GAP },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
