import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { FavoriteButton } from '@/components/favorite-button';
import { LibraryStatusBar } from '@/components/library-status-bar';
import { MovieWatchBar } from '@/components/movie-watch-bar';
import { RatingBar } from '@/components/rating-bar';
import { ReviewRow } from '@/components/review-row';
import { ThemedText } from '@/components/themed-text';
import { TvWatchBar } from '@/components/tv-watch-bar';
import { ThemedView } from '@/components/themed-view';
import { Accent, Danger, Glow, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { entityTypeFor, getTitleRatings } from '@/lib/ratings';
import {
  fetchTitle,
  imageUrl,
  type MediaType,
  type SeasonRow,
  type TitleRow,
} from '@/lib/tmdb';

export default function TitleDetailScreen() {
  const router = useRouter();
  const c = useTheme();
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

  const ratingsQ = useQuery({
    queryKey: ['titleRatings', title?.id],
    queryFn: () => getTitleRatings(entityTypeFor(title!.media_type), title!.id),
    enabled: !!title,
  });

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerTitle: '',
          headerTintColor: '#fff',
          headerRight: title
            ? () => <FavoriteButton titleId={title.id} />
            : undefined,
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading && <ActivityIndicator style={{ marginTop: Spacing.six }} />}
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {title && (
          <>
            {/* Backdrop header — letterboxed film frame (the signature) */}
            <View style={styles.backdropWrap}>
              <Image
                style={StyleSheet.absoluteFill}
                source={{
                  uri:
                    imageUrl(title.backdrop_path, 'w780') ??
                    imageUrl(title.poster_path, 'w780') ??
                    undefined,
                }}
                contentFit="cover"
                transition={200}
              />
              <LinearGradient
                colors={
                  ['transparent', 'rgba(0,0,0,0.5)', c.background] as [
                    string,
                    string,
                    string,
                  ]
                }
                locations={[0, 0.55, 1]}
                style={StyleSheet.absoluteFill}
              />
              {/* true-black letterbox bar — the film-frame cue */}
              <View style={styles.letterboxTop} />
              <View style={styles.headerRow}>
                <Image
                  style={styles.poster}
                  source={{
                    uri: imageUrl(title.poster_path, 'w342') ?? undefined,
                  }}
                  contentFit="cover"
                  transition={150}
                />
                <View style={styles.headerText}>
                  <Text style={styles.eyebrow}>
                    {title.media_type === 'tv' ? 'TV Series' : 'Film'}
                  </Text>
                  <Text style={styles.titleText} numberOfLines={3}>
                    {title.title}
                  </Text>
                  <Text style={styles.metaText}>
                    {[
                      year,
                      title.media_type === 'tv'
                        ? title.number_of_seasons != null
                          ? `${title.number_of_seasons} Season${title.number_of_seasons === 1 ? '' : 's'}`
                          : null
                        : title.runtime
                          ? `${title.runtime} Min`
                          : null,
                    ]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </Text>
                  <View style={styles.pills}>
                    {title.tmdb_rating != null && (
                      <View style={styles.pill}>
                        <Text style={styles.pillText}>
                          TMDB {title.tmdb_rating.toFixed(1)}
                        </Text>
                      </View>
                    )}
                    {title.imdb_rating != null && (
                      <View style={styles.pill}>
                        <Text style={styles.pillText}>
                          IMDb {title.imdb_rating.toFixed(1)}
                        </Text>
                      </View>
                    )}
                    {ratingsQ.data && ratingsQ.data.count > 0 && (
                      <View style={[styles.pill, styles.pillWb]}>
                        <Text style={[styles.pillText, styles.pillWbText]}>
                          WB {ratingsQ.data.average.toFixed(1)} ·{' '}
                          {ratingsQ.data.count}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </View>

            {/* Body */}
            <View style={styles.body}>
              <LibraryStatusBar titleId={title.id} />

              {title.media_type === 'movie' && (
                <MovieWatchBar titleId={title.id} />
              )}
              {title.media_type === 'tv' && seasons.length > 0 && (
                <TvWatchBar tmdbId={title.tmdb_id} seasons={seasons} />
              )}

              <View style={[styles.divider, { backgroundColor: c.border }]} />

              <RatingBar titleId={title.id} mediaType={title.media_type} />

              {title.overview ? (
                <ThemedText style={styles.overview}>
                  {title.overview}
                </ThemedText>
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
                        style={[
                          styles.seasonRow,
                          { backgroundColor: c.backgroundElement },
                        ]}
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
                        <ThemedText style={[styles.chevron, { color: c.textSecondary }]}>
                          ›
                        </ThemedText>
                      </Pressable>
                    ))}
                </View>
              )}

              {ratingsQ.data && ratingsQ.data.reviews.length > 0 && (
                <>
                  <View style={[styles.divider, { backgroundColor: c.border }]} />
                  <View style={styles.reviews}>
                    <ThemedText type="subtitle">Community reviews</ThemedText>
                    {ratingsQ.data.reviews.slice(0, 3).map((r) => (
                      <ReviewRow key={r.userId} review={r} />
                    ))}
                    {ratingsQ.data.reviews.length > 3 && (
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: '/title/[id]/reviews',
                            params: {
                              id: String(title.tmdb_id),
                              titleId: title.id,
                              type: title.media_type,
                              name: title.title,
                            },
                          })
                        }>
                        <ThemedText type="smallBold" style={{ color: Accent }}>
                          See all {ratingsQ.data.reviews.length} reviews ›
                        </ThemedText>
                      </Pressable>
                    )}
                  </View>
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const POSTER_W = 110;

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingBottom: Spacing.six },
  backdropWrap: {
    height: 320,
    justifyContent: 'flex-end',
    backgroundColor: '#000',
  },
  // The film-frame cue: a true-black letterbox bar across the top of the still.
  letterboxTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 22,
    backgroundColor: '#000',
  },
  headerRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    alignItems: 'flex-end',
  },
  poster: {
    width: POSTER_W,
    height: POSTER_W * 1.5,
    borderRadius: 4,
    backgroundColor: '#0003',
    borderWidth: 1,
    borderColor: 'rgba(245,241,232,0.15)',
  },
  headerText: { flex: 1, gap: Spacing.one, paddingBottom: Spacing.one },
  eyebrow: {
    fontFamily: Type.semibold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: Glow,
  },
  titleText: {
    fontFamily: Type.display,
    color: '#F5F1E8',
    fontSize: 30,
    lineHeight: 34,
  },
  metaText: {
    fontFamily: Type.semibold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'rgba(245,241,232,0.7)',
  },
  pills: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  pill: {
    borderWidth: 1,
    borderColor: 'rgba(245,241,232,0.28)',
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: 4,
  },
  pillText: {
    fontFamily: Type.semibold,
    color: '#F5F1E8',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  pillWb: { borderColor: Glow },
  pillWbText: { color: Glow },
  body: { padding: Spacing.three, gap: Spacing.three },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.one },
  reviews: { gap: Spacing.two },
  overview: { lineHeight: 22 },
  seasons: { gap: Spacing.two, marginTop: Spacing.two },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  chevron: { fontSize: 20 },
  error: { color: Danger, marginTop: Spacing.six, textAlign: 'center' },
});
