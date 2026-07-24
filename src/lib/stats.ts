import { LIBRARY_STATUSES } from '@/lib/library';
import { supabase } from '@/lib/supabase';
import { currentViewer } from '@/lib/viewer';

export type Stats = {
  totalMovieWatches: number;
  totalEpisodeWatches: number;
  totalMinutes: number;
  distinctTitles: number;
  thisYear: { minutes: number; movies: number; episodes: number };
  rating: {
    count: number;
    average: number | null;
    distribution: number[]; // length 11; index 1..10 used
  };
  topGenres: { name: string; count: number }[];
  topDirectors: { name: string; count: number }[];
  topActors: { name: string; count: number }[];
  ratingByGenre: { name: string; avg: number }[];
  topRated: { name: string; value: number }[];
  mostRewatched: { name: string; times: number } | null;
  mediaSplit: { movies: number; tv: number };
  libraryStatus: { label: string; count: number }[];
  topNetworks: { name: string; count: number }[];
  decades: { label: string; count: number }[];
  languages: { label: string; count: number }[];
  monthly: { label: string; count: number }[]; // last 12 months, oldest→newest
  patterns: {
    busiestWeekday: string | null;
    biggestDay: { label: string; count: number } | null;
    currentStreak: number;
    longestStreak: number;
    busiestMonth: { label: string; count: number } | null;
  };
};

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * The `get_stats` RPC returns tz/locale-independent numeric aggregates only; the
 * client (here) formats the locale/timezone-dependent labels. See migration 0013.
 */
type RawStats = {
  distinctTitles: number;
  totalMovieWatches: number;
  totalEpisodeWatches: number;
  totalMinutes: number;
  thisYear: { minutes: number; movies: number; episodes: number };
  topGenres: { name: string; count: number }[];
  topDirectors: { name: string; count: number }[];
  topActors: { name: string; count: number }[];
  ratingByGenre: { name: string; avg: number }[];
  topRated: { name: string; value: number }[];
  mostRewatched: { name: string; times: number } | null;
  mediaSplit: { movies: number; tv: number };
  libraryStatus: { status: string; count: number }[];
  topNetworks: { name: string; count: number }[];
  decades: { decade: number; count: number }[];
  languages: { code: string; count: number }[];
  rating: { count: number; average: number | null; distribution: number[] };
  monthly: { year: number; month: number; count: number }[];
  patterns: {
    busiestWeekday: number | null;
    biggestDay: { date: string; count: number } | null;
    currentStreak: number;
    longestStreak: number;
    busiestMonth: { year: number; month: number; count: number } | null;
  };
};

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Map the RPC's numeric/keyed payload into the label-formatted Stats the UI wants. */
function formatStats(raw: RawStats): Stats {
  const statusCount = new Map(raw.libraryStatus.map((s) => [s.status, s.count]));
  const libraryStatus = LIBRARY_STATUSES.map(({ value, label }) => ({
    label,
    count: statusCount.get(value) ?? 0,
  })).filter((s) => s.count > 0);

  const monthly = raw.monthly.map((m) => ({
    label: new Date(m.year, m.month - 1, 1).toLocaleDateString(undefined, {
      month: 'short',
    }),
    count: m.count,
  }));

  const p = raw.patterns;
  return {
    totalMovieWatches: raw.totalMovieWatches,
    totalEpisodeWatches: raw.totalEpisodeWatches,
    totalMinutes: raw.totalMinutes,
    distinctTitles: raw.distinctTitles,
    thisYear: raw.thisYear,
    rating: raw.rating,
    topGenres: raw.topGenres,
    topDirectors: raw.topDirectors,
    topActors: raw.topActors,
    ratingByGenre: raw.ratingByGenre,
    topRated: raw.topRated,
    mostRewatched: raw.mostRewatched,
    mediaSplit: raw.mediaSplit,
    libraryStatus,
    topNetworks: raw.topNetworks,
    decades: raw.decades.map((d) => ({ label: `${d.decade}s`, count: d.count })),
    languages: raw.languages.map((l) => ({
      label: l.code.toUpperCase(),
      count: l.count,
    })),
    monthly,
    patterns: {
      busiestWeekday: p.busiestWeekday == null ? null : WEEKDAYS[p.busiestWeekday],
      biggestDay: p.biggestDay
        ? {
            label: new Date(p.biggestDay.date).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            }),
            count: p.biggestDay.count,
          }
        : null,
      currentStreak: p.currentStreak,
      longestStreak: p.longestStreak,
      busiestMonth: p.busiestMonth
        ? {
            label: new Date(
              `${p.busiestMonth.year}-${String(p.busiestMonth.month).padStart(2, '0')}-01`,
            ).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
            count: p.busiestMonth.count,
          }
        : null,
    },
  };
}

/**
 * A user's statistics. May compute another user's (public) stats — reads are
 * world-open, so an explicit id is honoured, otherwise the viewer's own.
 * All aggregation runs server-side in the `get_stats` RPC (migration 0013); this
 * only formats locale/timezone labels.
 */
export async function getStats(userId?: string): Promise<Stats> {
  const uid = userId ?? (await currentViewer());
  if (!uid) throw new Error('Not signed in');

  const { data, error } = await supabase.rpc('get_stats', {
    p_user_id: uid,
    p_tz: deviceTimeZone(),
  });
  if (error) throw error;
  return formatStats(data as RawStats);
}
