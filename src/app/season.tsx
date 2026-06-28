import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { fetchSeason, type EpisodeRow } from '@/lib/tmdb';
import {
  getEpisodeWatchCounts,
  logEpisodeWatch,
  logManyEpisodeWatches,
  removeOneEpisodeWatch,
} from '@/lib/watches';

const ACTIVE = '#208AEF';

export default function SeasonScreen() {
  const { tmdbId, seasonNumber, name } = useLocalSearchParams<{
    tmdbId: string;
    seasonNumber: string;
    name?: string;
  }>();

  const queryClient = useQueryClient();
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  function invalidateWatchData() {
    queryClient.invalidateQueries({ queryKey: ['diary'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seasonBusy, setSeasonBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const eps = await fetchSeason(Number(tmdbId), Number(seasonNumber));
        const map =
          eps.length > 0
            ? await getEpisodeWatchCounts(eps[0].title_id)
            : new Map<string, number>();
        if (!active) return;
        setEpisodes(eps);
        setCounts(Object.fromEntries(map));
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tmdbId, seasonNumber]);

  function bump(id: string, delta: number) {
    setCounts((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + delta) }));
  }

  async function addWatch(ep: EpisodeRow) {
    bump(ep.id, +1);
    try {
      await logEpisodeWatch(ep.id, ep.title_id);
      invalidateWatchData();
    } catch {
      bump(ep.id, -1);
    }
  }

  async function removeWatch(ep: EpisodeRow) {
    if ((counts[ep.id] ?? 0) === 0) return;
    bump(ep.id, -1);
    try {
      await removeOneEpisodeWatch(ep.id);
      invalidateWatchData();
    } catch {
      bump(ep.id, +1);
    }
  }

  async function logWholeSeason() {
    if (seasonBusy || episodes.length === 0) return;
    setSeasonBusy(true);
    setCounts((c) => {
      const next = { ...c };
      for (const e of episodes) next[e.id] = (next[e.id] ?? 0) + 1;
      return next;
    });
    try {
      await logManyEpisodeWatches(
        episodes.map((e) => ({ id: e.id, title_id: e.title_id })),
      );
      invalidateWatchData();
    } catch {
      setCounts((c) => {
        const next = { ...c };
        for (const e of episodes) next[e.id] = Math.max(0, (next[e.id] ?? 0) - 1);
        return next;
      });
    } finally {
      setSeasonBusy(false);
    }
  }

  const watchedCount = episodes.filter((e) => (counts[e.id] ?? 0) > 0).length;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: name ?? 'Season' }} />
      {loading ? (
        <ActivityIndicator style={{ marginTop: Spacing.five }} />
      ) : error ? (
        <ThemedText style={styles.error}>{error}</ThemedText>
      ) : (
        <FlatList
          data={episodes}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.header}>
              <ThemedText type="small" style={styles.count}>
                {watchedCount} / {episodes.length} watched
              </ThemedText>
              <Pressable
                style={[styles.seasonButton, seasonBusy && styles.busy]}
                onPress={logWholeSeason}
                disabled={seasonBusy}>
                <ThemedText style={styles.seasonButtonText}>
                  ＋ Log whole season
                </ThemedText>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => {
            const n = counts[item.id] ?? 0;
            return (
              <View style={styles.row}>
                <Pressable
                  style={[styles.check, n > 0 && styles.checkOn]}
                  onPress={() => addWatch(item)}>
                  <ThemedText style={n > 0 ? styles.badgeOn : styles.badgeOff}>
                    {n === 0 ? '' : n === 1 ? '✓' : `×${n}`}
                  </ThemedText>
                </Pressable>
                <ThemedView style={styles.rowText}>
                  <ThemedText type="smallBold" numberOfLines={2}>
                    {item.episode_number}. {item.name ?? 'Episode'}
                  </ThemedText>
                  <ThemedText type="small">
                    {item.air_date ?? ''}
                    {item.runtime ? ` · ${item.runtime} min` : ''}
                  </ThemedText>
                </ThemedView>
                {n > 0 && (
                  <Pressable
                    style={styles.minus}
                    onPress={() => removeWatch(item)}
                    hitSlop={8}>
                    <ThemedText style={styles.minusText}>−</ThemedText>
                  </Pressable>
                )}
              </View>
            );
          }}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.three },
  header: { gap: Spacing.two, marginBottom: Spacing.two },
  count: { opacity: 0.7 },
  seasonButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    backgroundColor: ACTIVE,
  },
  seasonButtonText: { color: '#fff', fontWeight: '600' },
  busy: { opacity: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  check: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: ACTIVE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: ACTIVE },
  badgeOn: { color: '#fff', fontWeight: '700', fontSize: 13 },
  badgeOff: { color: 'transparent' },
  rowText: { flex: 1, gap: Spacing.half, backgroundColor: 'transparent' },
  minus: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#8888',
    alignItems: 'center',
    justifyContent: 'center',
  },
  minusText: { fontSize: 18, opacity: 0.7 },
  error: { color: '#e44', margin: Spacing.three },
});
