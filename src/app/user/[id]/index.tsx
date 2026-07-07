import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { FollowButton } from '@/components/follow-button';
import { PosterShelf, type PosterItem } from '@/components/poster-shelf';
import { RowSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
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
    queryKey: ['profile', id],
    queryFn: () => getProfileById(id),
  });
  const countsQ = useQuery({
    queryKey: ['followCounts', id],
    queryFn: () => getFollowCounts(id),
  });
  const followQ = useQuery({
    queryKey: ['follow', id],
    queryFn: () => getFollowState(id),
    enabled: !isMe,
  });
  const statsQ = useQuery({
    queryKey: ['userStats', id],
    queryFn: () => getStats(id),
  });
  const diaryQ = useQuery({
    queryKey: ['userDiary', id],
    queryFn: () => getDiary({ userId: id, limit: 12 }),
  });
  const libraryQ = useQuery({
    queryKey: ['userLibrary', id],
    queryFn: () => getLibraryFor(id),
  });

  // Optimistic follower count: shift by the difference between the button's
  // current state and the state we originally loaded.
  const initiallyFollowing = followQ.data ?? false;
  const [followingNow, setFollowingNow] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (followQ.data !== undefined) setFollowingNow(followQ.data);
  }, [followQ.data]);
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

  const profile = profileQ.data;
  const name =
    profile?.display_name?.trim() ||
    (profile?.username ? `@${profile.username}` : 'User');
  const initial = (name.replace('@', '') || '?').charAt(0).toUpperCase();
  const stats = statsQ.data;

  const header = (
    <View style={styles.header}>
      {profile?.avatar_url ? (
        <Image
          style={styles.avatar}
          source={{ uri: profile.avatar_url }}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <ThemedText style={styles.avatarInitial}>{initial}</ThemedText>
        </View>
      )}

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
          }>
          <ThemedText type="smallBold">{followers}</ThemedText>
          <ThemedText type="small" style={{ color: c.textSecondary }}>
            {' followers'}
          </ThemedText>
        </Pressable>
        <Pressable
          style={styles.countItem}
          onPress={() =>
            router.push({ pathname: '/user/[id]/following', params: { id } })
          }>
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

      <View style={styles.statRow}>
        <StatCard value={String(stats?.distinctTitles ?? 0)} label="Titles" />
        <StatCard value={String(stats?.totalMovieWatches ?? 0)} label="Movies" />
        <StatCard value={String(stats?.totalEpisodeWatches ?? 0)} label="Episodes" />
        <StatCard
          value={String(Math.round((stats?.totalMinutes ?? 0) / 60))}
          label="Hours"
        />
      </View>

      {/* Taste card — what this person actually watches. */}
      {stats && stats.topGenres.length > 0 && (
        <View style={[styles.tasteCard, { backgroundColor: c.backgroundElement }]}>
          <View style={styles.genreChips}>
            {stats.topGenres.slice(0, 5).map((g) => (
              <View style={[styles.chip, { borderColor: c.border }]} key={g.name}>
                <ThemedText type="small">{g.name}</ThemedText>
              </View>
            ))}
          </View>
          <ThemedText type="small" style={{ color: c.textSecondary }}>
            {stats.mediaSplit.movies} movies · {stats.mediaSplit.tv} shows watched
          </ThemedText>
          {stats.topActors.length > 0 && (
            <ThemedText type="small" numberOfLines={2}>
              <ThemedText type="smallBold">Often watches </ThemedText>
              {stats.topActors.slice(0, 3).map((a) => a.name).join(', ')}
            </ThemedText>
          )}
          {stats.topDirectors.length > 0 && (
            <ThemedText type="small" numberOfLines={2}>
              <ThemedText type="smallBold">Favorite directors </ThemedText>
              {stats.topDirectors.slice(0, 3).map((d) => d.name).join(', ')}
            </ThemedText>
          )}
        </View>
      )}

      <View style={styles.shelves}>
        {watchingShelf.length > 0 && (
          <PosterShelf title="Watching now" items={watchingShelf} onPressItem={openTitle} />
        )}
        {favoritesShelf.length > 0 && (
          <PosterShelf title="Favorites" items={favoritesShelf} onPressItem={openTitle} />
        )}
        {completedShelf.length > 0 && (
          <PosterShelf title="Recently completed" items={completedShelf} onPressItem={openTitle} />
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
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#0002' },
  avatarFallback: { backgroundColor: Accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#fff', fontSize: 36, lineHeight: 44, fontWeight: '700' },
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
  statValue: { fontSize: 22, fontWeight: '800', color: Accent },
  recentHeading: { alignSelf: 'flex-start', marginTop: Spacing.three },
  tasteCard: {
    alignSelf: 'stretch',
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  genreChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  shelves: { alignSelf: 'stretch', gap: Spacing.four, marginTop: Spacing.three },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
    padding: Spacing.two,
    borderRadius: Spacing.three,
  },
  poster: { width: 52, height: 78, borderRadius: Spacing.one, backgroundColor: '#0002' },
  rowText: { flex: 1, gap: Spacing.half, backgroundColor: 'transparent' },
  date: { opacity: 0.6 },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
