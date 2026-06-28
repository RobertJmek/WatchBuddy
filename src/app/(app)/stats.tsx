import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Spacing } from '@/constants/theme';
import { getStats } from '@/lib/stats';

const ACTIVE = Accent;

function formatDuration(minutes: number) {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText style={styles.cardValue}>{value}</ThemedText>
      <ThemedText type="small" style={styles.cardLabel}>
        {label}
      </ThemedText>
    </ThemedView>
  );
}

function BarRow({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pct = max > 0 ? Math.max(0.03, value / max) : 0;
  return (
    <View style={styles.barRow}>
      <ThemedText type="small" style={styles.barLabel} numberOfLines={1}>
        {label}
      </ThemedText>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { flex: pct }]} />
        <View style={{ flex: 1 - pct }} />
      </View>
      <ThemedText type="small" style={styles.barValue}>
        {value}
      </ThemedText>
    </View>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.factRow}>
      <ThemedText type="small">{label}</ThemedText>
      <ThemedText type="smallBold" style={styles.factValue}>
        {value}
      </ThemedText>
    </View>
  );
}

function PersonRow({
  rank,
  name,
  count,
}: {
  rank: number;
  name: string;
  count: number;
}) {
  return (
    <View style={styles.personRow}>
      <ThemedText type="small" numberOfLines={1} style={styles.personName}>
        {rank}. {name}
      </ThemedText>
      <ThemedText type="small" style={styles.personCount}>
        {count}
      </ThemedText>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <ThemedView type="backgroundElement" style={styles.section}>
      <ThemedText type="smallBold" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </ThemedText>
      {children}
    </ThemedView>
  );
}

export default function StatsScreen() {
  const {
    data: stats,
    isLoading: loading,
    refetch,
  } = useQuery({ queryKey: ['stats'], queryFn: getStats });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <ThemedText type="title" style={styles.heading}>
            Statistics
          </ThemedText>
          <ActivityIndicator style={{ marginTop: Spacing.five }} />
        </SafeAreaView>
      </ThemedView>
    );
  }
  if (!stats) return null;

  const monthMax = Math.max(1, ...stats.monthly.map((m) => m.count));
  const genreMax = Math.max(1, ...stats.topGenres.map((g) => g.count));
  const decadeMax = Math.max(1, ...stats.decades.map((d) => d.count));
  const langMax = Math.max(1, ...stats.languages.map((l) => l.count));
  const ratingMax = Math.max(1, ...stats.rating.distribution);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedText type="title" style={styles.heading}>
          Statistics
        </ThemedText>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedView type="backgroundElement" style={styles.hero}>
            <ThemedText style={styles.heroValue}>
              {formatDuration(stats.totalMinutes)}
            </ThemedText>
            <ThemedText type="small" style={styles.heroLabel}>
              total watched
            </ThemedText>
          </ThemedView>

          <View style={styles.cards}>
            <StatCard label="Titles" value={String(stats.distinctTitles)} />
            <StatCard label="Movie watches" value={String(stats.totalMovieWatches)} />
            <StatCard label="Episodes" value={String(stats.totalEpisodeWatches)} />
          </View>

        <Section title={`${new Date().getFullYear()} so far`}>
          <ThemedText>
            {formatDuration(stats.thisYear.minutes)} · {stats.thisYear.movies}{' '}
            movies · {stats.thisYear.episodes} episodes
          </ThemedText>
        </Section>

        {stats.patterns && (
          <Section title="Patterns">
            {stats.patterns.currentStreak > 0 && (
              <FactRow label="Current streak" value={`${stats.patterns.currentStreak} days`} />
            )}
            {stats.patterns.longestStreak > 0 && (
              <FactRow label="Longest streak" value={`${stats.patterns.longestStreak} days`} />
            )}
            {stats.patterns.busiestWeekday && (
              <FactRow label="Busiest day" value={stats.patterns.busiestWeekday} />
            )}
            {stats.patterns.biggestDay && (
              <FactRow
                label="Biggest day"
                value={`${stats.patterns.biggestDay.label} · ${stats.patterns.biggestDay.count}`}
              />
            )}
            {stats.patterns.busiestMonth && (
              <FactRow
                label="Busiest month"
                value={`${stats.patterns.busiestMonth.label} · ${stats.patterns.busiestMonth.count}`}
              />
            )}
          </Section>
        )}

        <Section title="Last 12 months">
          <View style={styles.monthChart}>
            {stats.monthly.map((m, i) => (
              <View key={i} style={styles.monthCol}>
                <View style={styles.monthBarTrack}>
                  <View
                    style={[
                      styles.monthBar,
                      { height: `${(m.count / monthMax) * 100}%` },
                    ]}
                  />
                </View>
                <ThemedText type="small" style={styles.monthLabel}>
                  {m.label}
                </ThemedText>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Ratings">
          {stats.rating.count > 0 ? (
            <>
              <ThemedText>
                Average {stats.rating.average?.toFixed(1)} · {stats.rating.count}{' '}
                rated
              </ThemedText>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <BarRow
                  key={n}
                  label={String(n)}
                  value={stats.rating.distribution[n]}
                  max={ratingMax}
                />
              ))}
            </>
          ) : (
            <ThemedText type="small">No ratings yet.</ThemedText>
          )}
        </Section>

        {stats.topGenres.length > 0 && (
          <Section title="Top genres">
            {stats.topGenres.map((g) => (
              <BarRow key={g.name} label={g.name} value={g.count} max={genreMax} />
            ))}
          </Section>
        )}

        {(stats.topDirectors?.length ?? 0) > 0 && (
          <Section title="Top directors">
            {stats.topDirectors.map((p, i) => (
              <PersonRow key={p.name} rank={i + 1} name={p.name} count={p.count} />
            ))}
          </Section>
        )}

        {(stats.topActors?.length ?? 0) > 0 && (
          <Section title="Top actors">
            {stats.topActors.map((p, i) => (
              <PersonRow key={p.name} rank={i + 1} name={p.name} count={p.count} />
            ))}
          </Section>
        )}

        {((stats.ratingByGenre?.length ?? 0) > 0 ||
          (stats.topRated?.length ?? 0) > 0 ||
          stats.mostRewatched) && (
          <Section title="Taste insights">
            {stats.mostRewatched && (
              <FactRow
                label="Most rewatched"
                value={`${stats.mostRewatched.name} ·×${stats.mostRewatched.times}`}
              />
            )}
            {(stats.ratingByGenre?.length ?? 0) > 0 && (
              <>
                <ThemedText type="smallBold" style={styles.subhead}>
                  Average rating by genre
                </ThemedText>
                {stats.ratingByGenre.map((g) => (
                  <FactRow key={g.name} label={g.name} value={g.avg.toFixed(1)} />
                ))}
              </>
            )}
            {(stats.topRated?.length ?? 0) > 0 && (
              <>
                <ThemedText type="smallBold" style={styles.subhead}>
                  Highest rated
                </ThemedText>
                {stats.topRated.map((t, i) => (
                  <PersonRow key={`${t.name}-${i}`} rank={i + 1} name={t.name} count={t.value} />
                ))}
              </>
            )}
          </Section>
        )}

        {(() => {
          const ms = stats.mediaSplit;
          const total = ms ? ms.movies + ms.tv : 0;
          const hasLib = (stats.libraryStatus?.length ?? 0) > 0;
          const hasNet = (stats.topNetworks?.length ?? 0) > 0;
          if (total === 0 && !hasLib && !hasNet) return null;
          const netMax = Math.max(1, ...(stats.topNetworks ?? []).map((n) => n.count));
          return (
            <Section title="Library & networks">
              {total > 0 && (
                <FactRow
                  label="Movies vs TV"
                  value={`${Math.round((ms.movies / total) * 100)}% · ${Math.round(
                    (ms.tv / total) * 100,
                  )}%`}
                />
              )}
              {hasLib && (
                <>
                  <ThemedText type="smallBold" style={styles.subhead}>
                    By status
                  </ThemedText>
                  {stats.libraryStatus.map((s) => (
                    <FactRow key={s.label} label={s.label} value={String(s.count)} />
                  ))}
                </>
              )}
              {hasNet && (
                <>
                  <ThemedText type="smallBold" style={styles.subhead}>
                    Top networks
                  </ThemedText>
                  {stats.topNetworks.map((n) => (
                    <BarRow key={n.name} label={n.name} value={n.count} max={netMax} />
                  ))}
                </>
              )}
            </Section>
          );
        })()}

        {stats.decades.length > 0 && (
          <Section title="By decade">
            {stats.decades.map((d) => (
              <BarRow key={d.label} label={d.label} value={d.count} max={decadeMax} />
            ))}
          </Section>
        )}

        {stats.languages.length > 0 && (
          <Section title="By language">
            {stats.languages.map((l) => (
              <BarRow key={l.label} label={l.label} value={l.count} max={langMax} />
            ))}
          </Section>
        )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  heading: { marginTop: Spacing.three, paddingHorizontal: Spacing.three },
  content: { padding: Spacing.three, gap: Spacing.three },
  hero: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    alignItems: 'center',
    gap: Spacing.half,
  },
  heroValue: { fontSize: 44, fontWeight: '800', color: ACTIVE, lineHeight: 50 },
  heroLabel: { textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  card: {
    flexGrow: 1,
    flexBasis: '30%',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.half,
    alignItems: 'center',
  },
  cardValue: { fontSize: 22, fontWeight: '800', color: ACTIVE },
  cardLabel: { textAlign: 'center', opacity: 0.7 },
  section: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sectionTitle: {
    letterSpacing: 0.5,
    opacity: 0.5,
    marginBottom: Spacing.half,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.half,
  },
  barLabel: { width: 70 },
  barTrack: {
    flex: 1,
    height: 10,
    flexDirection: 'row',
    backgroundColor: '#8883',
    borderRadius: 5,
    overflow: 'hidden',
  },
  barFill: { backgroundColor: ACTIVE, borderRadius: 5 },
  barValue: { width: 28, textAlign: 'right' },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.half,
  },
  personName: { flex: 1 },
  personCount: { color: ACTIVE, fontWeight: '700' },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.half,
  },
  factValue: { color: ACTIVE },
  subhead: {
    marginTop: Spacing.two,
    marginBottom: Spacing.half,
    opacity: 0.5,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  monthChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.one,
    height: 120,
  },
  monthCol: { flex: 1, alignItems: 'center', gap: Spacing.half },
  monthBarTrack: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  monthBar: { width: '100%', backgroundColor: ACTIVE, borderRadius: 3, minHeight: 2 },
  monthLabel: { fontSize: 9, opacity: 0.7 },
});
