import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { LibraryStatusBar } from '@/components/library-status-bar';
import { MovieWatchBar } from '@/components/movie-watch-bar';
import { RatingBar } from '@/components/rating-bar';
import { ThemedText } from '@/components/themed-text';
import { TvWatchBar } from '@/components/tv-watch-bar';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  fetchTitle,
  imageUrl,
  type MediaType,
  type SeasonRow,
  type TitleRow,
} from '@/lib/tmdb';

export default function TitleDetailScreen() {
  const router = useRouter();
  const { id, type, name } = useLocalSearchParams<{
    id: string;
    type: MediaType;
    name?: string;
  }>();

  const [title, setTitle] = useState<TitleRow | null>(null);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await fetchTitle(Number(id), type);
        if (!active) return;
        setTitle(data.title);
        setSeasons(data.seasons ?? []);
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, type]);

  const year = title?.release_date?.slice(0, 4);

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: name ?? '' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {loading && <ActivityIndicator style={{ marginTop: Spacing.five }} />}
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {title && (
          <>
            <View style={styles.header}>
              <Image
                style={styles.poster}
                source={{ uri: imageUrl(title.poster_path, 'w342') ?? undefined }}
                contentFit="cover"
                transition={150}
              />
              <View style={styles.headerText}>
                <ThemedText type="subtitle">{title.title}</ThemedText>
                <ThemedText type="small">
                  {title.media_type === 'tv' ? 'TV Series' : 'Movie'}
                  {year ? ` · ${year}` : ''}
                  {title.runtime ? ` · ${title.runtime} min` : ''}
                </ThemedText>
                <ThemedText type="small">
                  {title.tmdb_rating != null
                    ? `TMDB ${title.tmdb_rating.toFixed(1)}`
                    : ''}
                  {title.imdb_rating != null
                    ? `   IMDb ${title.imdb_rating.toFixed(1)}`
                    : ''}
                </ThemedText>
                {title.media_type === 'tv' && title.number_of_seasons != null && (
                  <ThemedText type="small">
                    {title.number_of_seasons} seasons ·{' '}
                    {title.number_of_episodes} episodes
                  </ThemedText>
                )}
              </View>
            </View>

            <LibraryStatusBar titleId={title.id} />

            {title.media_type === 'movie' && (
              <MovieWatchBar titleId={title.id} />
            )}

            {title.media_type === 'tv' && seasons.length > 0 && (
              <TvWatchBar tmdbId={title.tmdb_id} seasons={seasons} />
            )}

            <RatingBar titleId={title.id} mediaType={title.media_type} />

            {title.overview ? (
              <ThemedText style={styles.overview}>{title.overview}</ThemedText>
            ) : null}

            {seasons.length > 0 && (
              <View style={styles.seasons}>
                <ThemedText type="subtitle">Seasons</ThemedText>
                {seasons
                  .slice()
                  .sort((a, b) => a.season_number - b.season_number)
                  .map((s) => (
                    <Pressable
                      key={s.id}
                      style={styles.seasonRow}
                      onPress={() =>
                        router.push({
                          pathname: '/season',
                          params: {
                            tmdbId: String(title.tmdb_id),
                            seasonNumber: String(s.season_number),
                            name: s.name ?? `Season ${s.season_number}`,
                          },
                        })
                      }>
                      <ThemedText>
                        {s.name ?? `Season ${s.season_number}`}
                        {s.episode_count ? ` · ${s.episode_count} eps` : ''}
                      </ThemedText>
                      <ThemedText style={styles.chevron}>›</ThemedText>
                    </Pressable>
                  ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  header: { flexDirection: 'row', gap: Spacing.three },
  poster: {
    width: 120,
    height: 180,
    borderRadius: Spacing.two,
    backgroundColor: '#0002',
  },
  headerText: { flex: 1, gap: Spacing.one },
  overview: { lineHeight: 22 },
  seasons: { gap: Spacing.two, marginTop: Spacing.two },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  chevron: { opacity: 0.4, fontSize: 20 },
  error: { color: '#e44', marginTop: Spacing.three },
});
