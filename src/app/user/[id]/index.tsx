import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import { Avatar } from '@/components/avatar';
import { FollowButton } from '@/components/follow-button';
import { PosterShelf, type PosterItem } from '@/components/poster-shelf';
import { RowSkeleton, Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { keys } from '@/lib/keys';
import { useAuth } from '@/lib/auth-context';
import { openTitle } from '@/lib/navigation';
import { getLibraryFor, type LibraryEntry } from '@/lib/library';
import { getProfileById } from '@/lib/profile';
import { getFollowCounts, getFollowState } from '@/lib/social';
import { getStats } from '@/lib/stats';
import { imageUrl } from '@/lib/tmdb';
import { getDiary } from '@/lib/watches';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function StatCard({ value, label }: { value: string; label: string }) {
  const c = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: c.backgroundElement }]}>
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText type="small" style={{ color: c.textSecondary }}>
        {label}
      </ThemedText>
    </View>
  );
}

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useTheme();
  const { session } = useAuth();
  const isMe = session?.user.id === id;

  const profileQ = useQuery({
    queryKey: keys.profile(id),
    queryFn: () => getProfileById(id),
  });
  const countsQ = useQuery({
    queryKey: keys.followCounts(id),
    queryFn: () => getFollowCounts(id),
  });
  const followQ = useQuery({
    queryKey: keys.follow(id),
    queryFn: () => getFollowState(id),
    enabled: !isMe,
  });
  const statsQ = useQuery({
    queryKey: keys.stats(id),
    queryFn: () => getStats(id),
  });
  const diaryQ = useQuery({
    queryKey: keys.diary(id),
    queryFn: () => getDiary({ userId: id, limit: 12 }),
  });
  const libraryQ = useQuery({
    queryKey: keys.library(id),
    queryFn: () => getLibraryFor(id),
  });

  // Optimistic follower count: shift by the difference between the button's
  // current state and the state we originally loaded.
  const initiallyFollowing = followQ.data ?? false;
  const [followingNow, setFollowingNow] = useState<boolean | undefined>(undefined);
  /* eslint-disable react-hooks/set-state-in-effect -- the count is shifted
     optimistically against the state we first loaded, so the button's current
     state has to be held locally rather than derived from the query. */
  useEffect(() => {
    if (followQ.data !== undefined) setFollowingNow(followQ.data);
  }, [followQ.data]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const followers =
    (countsQ.data?.followers ?? 0) +
    ((followingNow ? 1 : 0) - (initiallyFollowing ? 1 : 0));
  const following = countsQ.data?.following ?? 0;

  // Library-derived shelves (entries arrive newest-updated first).
  const toShelfItem = (e: LibraryEntry): PosterItem | null =>
    e.title
      ? {
          key: e.id,
          tmdb_id: e.title.tmdb_id,
          media_type: e.title.media_type,
          title: e.title.title,
          poster_path: e.title.poster_path,
        }
      : null;
  const shelfOf = (pred: (e: LibraryEntry) => boolean): PosterItem[] =>
    (libraryQ.data ?? [])
      .filter(pred)
      .slice(0, 10)
      .map(toShelfItem)
      .filter((i): i is PosterItem => i !== null);
  const watchingShelf = shelfOf((e) => e.status === 'watching');
  const favoritesShelf = shelfOf((e) => e.is_favorite);
  const completedShelf = shelfOf((e) => e.status === 'completed');

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      profileQ.refetch(),
      countsQ.refetch(),
      statsQ.refetch(),
      diaryQ.refetch(),
      libraryQ.refetch(),
    ]);
    setRefreshing(false);
  };

  function openPoster(item: PosterItem) {
    openTitle(router, {
      tmdbId: item.tmdb_id,
      mediaType: item.media_type,
      name: item.title,
    });
  }

  const profile = profileQ.data;
  const name =
    profile?.display_name?.trim() ||
    (profile?.username ? `@${profile.username}` : 'User');
  const stats = statsQ.data;

  const header = (
    <View style={styles.header}>
      <Avatar uri={profile?.avatar_url} name={name} size={88} />

      <ThemedText type="title">{name}</ThemedText>
      {profile?.username ? (
        <ThemedText type="small" style={{ color: c.textSecondary }}>
          @{profile.username}
        </ThemedText>
      ) : null}
      {profile?.bio ? (
        <ThemedText style={styles.bio}>{profile.bio}</ThemedText>
      ) : null}

      <View style={styles.counts}>
        <Pressable
          style={styles.countItem}
          onPress={() =>
            router.push({ pathname: '/user/[id]/followers', params: { id } })
          }
          accessibilityRole="button"
          accessibilityLabel={`${followers} followers`}>
          <ThemedText type="smallBold">{followers}</ThemedText>
          <ThemedText type="small" style={{ color: c.textSecondary }}>
            {' followers'}
          </ThemedText>
        </Pressable>
        <Pressable
          style={styles.countItem}
          onPress={() =>
            router.push({ pathname: '/user/[id]/following', params: { id } })
          }
          accessibilityRole="button"
          accessibilityLabel={`Following ${following} people`}>
          <ThemedText type="smallBold">{following}</ThemedText>
          <ThemedText type="small" style={{ color: c.textSecondary }}>
            {' following'}
          </ThemedText>
        </Pressable>
      </View>

      {!isMe && followingNow !== undefined ? (
        <FollowButton
          userId={id}
          initialFollowing={initiallyFollowing}
          onChange={setFollowingNow}
        />
      ) : null}

      {/* First load has no cached stats yet — show placeholders instead of a
          row of zeros (misreads as "this person watched nothing"). */}
      {statsQ.isLoading ? (
        <View style={styles.statRow}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={styles.statSkeleton} />
          ))}
        </View>
      ) : (
        <View style={styles.statRow}>
          <StatCard value={String(stats?.distinctTitles ?? 0)} label="Titles" />
          <StatCard value={String(stats?.totalMovieWatches ?? 0)} label="Movies" />
          <StatCard value={String(stats?.totalEpisodeWatches ?? 0)} label="Episodes" />
          <StatCard
            value={String(Math.round((stats?.totalMinutes ?? 0) / 60))}
            label="Hours"
          />
        </View>
      )}

      {/* Taste — what this person actually watches. Open, airy layout in the
          app's eyebrow style rather than a boxed card. */}
      {stats && stats.topGenres.length > 0 && (
        <View style={styles.taste}>
          <View style={styles.genreChips}>
            {stats.topGenres.slice(0, 4).map((g) => (
              <View
                style={[styles.chip, { backgroundColor: c.backgroundElement }]}
                key={g.name}>
                <ThemedText type="small">{g.name}</ThemedText>
              </View>
            ))}
          </View>
          {stats.topActors.length > 0 && (
            <View style={styles.tasteBlock}>
              <ThemedText type="meta" style={{ color: c.textSecondary }}>
                Often watches
              </ThemedText>
              <ThemedText type="small" numberOfLines={1}>
                {stats.topActors.slice(0, 3).map((a) => a.name).join(' · ')}
              </ThemedText>
            </View>
          )}
          {stats.topDirectors.length > 0 && (
            <View style={styles.tasteBlock}>
              <ThemedText type="meta" style={{ color: c.textSecondary }}>
                Favorite directors
              </ThemedText>
              <ThemedText type="small" numberOfLines={1}>
                {stats.topDirectors.slice(0, 3).map((d) => d.name).join(' · ')}
              </ThemedText>
            </View>
          )}
        </View>
      )}

      <View style={styles.shelves}>
        {watchingShelf.length > 0 && (
          <PosterShelf title="Watching now" items={watchingShelf} onPressItem={openPoster} />
        )}
        {favoritesShelf.length > 0 && (
          <PosterShelf title="Favorites" items={favoritesShelf} onPressItem={openPoster} />
        )}
        {completedShelf.length > 0 && (
          <PosterShelf title="Recently completed" items={completedShelf} onPressItem={openPoster} />
        )}
      </View>

      <ThemedText type="subtitle" style={styles.recentHeading}>
        Recent activity
      </ThemedText>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: '' }} />
      {profileQ.isLoading ? (
        <View style={{ padding: Spacing.three, gap: Spacing.two }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          data={diaryQ.data ?? []}
          keyExtractor={(e) => e.id}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={c.tint}
              colors={[c.tint]}
            />
          }
          ListEmptyComponent={
            !diaryQ.isLoading ? (
              <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
                No watch history yet.
              </ThemedText>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={[styles.row, { backgroundColor: c.backgroundElement }]}
              onPress={() =>
                openTitle(router, {
                  tmdbId: item.tmdbId,
                  mediaType: item.mediaType,
                  name: item.titleName,
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
                {item.subtitle ? (
                  <ThemedText type="small" numberOfLines={1}>
                    {item.subtitle}
                  </ThemedText>
                ) : null}
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
  list: { padding: Spacing.three, gap: Spacing.two },
  header: { alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.three },
  bio: { textAlign: 'center', lineHeight: 21 },
  counts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  countItem: { flexDirection: 'row', alignItems: 'center' },
  statRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignSelf: 'stretch',
    marginTop: Spacing.two,
  },
  statCard: {
    flex: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    gap: Spacing.half,
  },
  statSkeleton: { flex: 1, height: 80, borderRadius: Spacing.three },
  statValue: { fontSize: 22, fontWeight: '800', color: Accent },
  recentHeading: { alignSelf: 'flex-start', marginTop: Spacing.three },
  taste: {
    alignSelf: 'stretch',
    gap: Spacing.three,
    marginTop: Spacing.three,
  },
  tasteBlock: { gap: Spacing.half },
  genreChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  shelves: { alignSelf: 'stretch', gap: Spacing.four, marginTop: Spacing.three },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
    padding: Spacing.two,
    borderRadius: Spacing.three,
  },
  poster: { width: 52, height: 78, borderRadius: Spacing.one, backgroundColor: PlaceholderBg },
  rowText: { flex: 1, gap: Spacing.half, backgroundColor: 'transparent' },
  date: { opacity: 0.6 },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
