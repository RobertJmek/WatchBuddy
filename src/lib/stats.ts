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

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

type TitleMeta = {
  runtime: number | null;
  original_language: string | null;
  release_date: string | null;
  media_type: 'movie' | 'tv' | null;
};

type WatchRow = {
  watched_at: string;
  title_id: string;
  minutes: number;
  meta: TitleMeta | null;
  titleName: string | null;
  episodeId: string | null;
};

function yearOf(iso: string) {
  return new Date(iso).getFullYear();
}

export async function getStats(userId?: string): Promise<Stats> {
  // May compute another user's (public) stats, so honour an explicit id and
  // otherwise fall back to the viewer.
  const uid = userId ?? (await currentViewer());
  if (!uid) throw new Error('Not signed in');

  // Watch tables can exceed PostgREST's 1000-row page cap (e.g. after a bulk
  // import), so page through them instead of a single select.
  const PAGE = 1000;
  const fetchAll = async (table: string, select: string) => {
    const rows: any[] = [];
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .eq('user_id', uid)
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE) return rows;
    }
  };

  // Same cap applies to catalog joins over many watched titles (credits alone
  // run ~16 rows per title), so page those too.
  const fetchAllIn = async (table: string, select: string, ids: string[]) => {
    const rows: any[] = [];
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .in('title_id', ids)
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE) return rows;
    }
  };

  const [episodesData, moviesData, ratingsRes] = await Promise.all([
    fetchAll(
      'episode_watches',
      'watched_at, title_id, episode_id, episode:episodes(runtime), title:titles(title, runtime, original_language, release_date, media_type)',
    ),
    fetchAll(
      'movie_watches',
      'watched_at, title_id, title:titles(title, runtime, original_language, release_date, media_type)',
    ),
    supabase
      .from('ratings')
      .select('value, entity_type, entity_id')
      .eq('user_id', uid),
  ]);
  if (ratingsRes.error) throw ratingsRes.error;

  const episodeWatches: WatchRow[] = episodesData.map((r: any) => ({
    watched_at: r.watched_at,
    title_id: r.title_id,
    minutes: r.episode?.runtime ?? r.title?.runtime ?? 0,
    meta: r.title ?? null,
    titleName: r.title?.title ?? null,
    episodeId: r.episode_id ?? null,
  }));
  const movieWatches: WatchRow[] = moviesData.map((r: any) => ({
    watched_at: r.watched_at,
    title_id: r.title_id,
    minutes: r.title?.runtime ?? 0,
    meta: r.title ?? null,
    titleName: r.title?.title ?? null,
    episodeId: null,
  }));
  const all = [...episodeWatches, ...movieWatches];

  const thisYear = new Date().getFullYear();

  // Totals + this-year + monthly buckets.
  let totalMinutes = 0;
  let tyMinutes = 0;
  let tyMovies = 0;
  let tyEpisodes = 0;
  const monthCounts = new Map<string, number>();
  for (const w of all) totalMinutes += w.minutes;
  for (const w of episodeWatches) {
    if (yearOf(w.watched_at) === thisYear) {
      tyEpisodes++;
      tyMinutes += w.minutes;
    }
  }
  for (const w of movieWatches) {
    if (yearOf(w.watched_at) === thisYear) {
      tyMovies++;
      tyMinutes += w.minutes;
    }
  }
  for (const w of all) {
    const d = new Date(w.watched_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);
  }

  // Distinct titles + their metadata for genre/decade/language breakdowns.
  const titleMeta = new Map<string, TitleMeta>();
  for (const w of all) if (w.meta && !titleMeta.has(w.title_id)) titleMeta.set(w.title_id, w.meta);
  const distinctIds = [...titleMeta.keys()];

  // Rated movie/show titles (for taste insights).
  const ratingRows = (ratingsRes.data ?? []) as any[];
  const titleRatings = ratingRows.filter(
    (r) => r.entity_type === 'movie' || r.entity_type === 'show',
  );
  const ratedIds = [...new Set(titleRatings.map((r) => r.entity_id as string))];

  // Genres for watched + rated titles, keyed by title for reuse below.
  const genresByTitle = new Map<string, string[]>();
  const genreIds = [...new Set([...distinctIds, ...ratedIds])];
  if (genreIds.length > 0) {
    const data = await fetchAllIn('title_genres', 'title_id, genres(name)', genreIds);
    for (const row of data ?? []) {
      const name = (row as any).genres?.name as string | undefined;
      const tid = (row as any).title_id as string;
      if (name) {
        const arr = genresByTitle.get(tid);
        if (arr) arr.push(name);
        else genresByTitle.set(tid, [name]);
      }
    }
  }

  // Genre frequency over distinct watched titles.
  const genreCounts = new Map<string, number>();
  for (const id of distinctIds) {
    for (const name of genresByTitle.get(id) ?? []) {
      genreCounts.set(name, (genreCounts.get(name) ?? 0) + 1);
    }
  }

  // Average rating by genre.
  const genreRating = new Map<string, { sum: number; count: number }>();
  for (const r of titleRatings) {
    for (const name of genresByTitle.get(r.entity_id) ?? []) {
      const e = genreRating.get(name) ?? { sum: 0, count: 0 };
      e.sum += r.value;
      e.count += 1;
      genreRating.set(name, e);
    }
  }

  // Title names for rated / rewatched titles (from watches, plus a lookup for
  // any rated title that isn't in the watch history).
  const nameById = new Map<string, string>();
  for (const w of all) if (w.titleName) nameById.set(w.title_id, w.titleName);
  const missingNames = ratedIds.filter((id) => !nameById.has(id));
  if (missingNames.length > 0) {
    const { data } = await supabase
      .from('titles')
      .select('id, title')
      .in('id', missingNames);
    for (const row of data ?? []) nameById.set((row as any).id, (row as any).title);
  }

  // Highest-rated titles.
  const topRated = [...titleRatings]
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map((r) => ({ name: nameById.get(r.entity_id) ?? 'Unknown', value: r.value }));

  // Most rewatched: a movie's watch count, or a show's max single-episode count.
  const movieCountByTitle = new Map<string, number>();
  for (const w of movieWatches) {
    movieCountByTitle.set(w.title_id, (movieCountByTitle.get(w.title_id) ?? 0) + 1);
  }
  const episodeCount = new Map<string, number>(); // episodeId -> count
  const titleByEpisode = new Map<string, string>();
  for (const w of episodeWatches) {
    if (!w.episodeId) continue;
    episodeCount.set(w.episodeId, (episodeCount.get(w.episodeId) ?? 0) + 1);
    titleByEpisode.set(w.episodeId, w.title_id);
  }
  const timesByTitle = new Map<string, number>(movieCountByTitle);
  for (const [epId, count] of episodeCount) {
    const tid = titleByEpisode.get(epId)!;
    timesByTitle.set(tid, Math.max(timesByTitle.get(tid) ?? 0, count));
  }
  let mostRewatched: { name: string; times: number } | null = null;
  for (const [tid, times] of timesByTitle) {
    if (times >= 2 && (!mostRewatched || times > mostRewatched.times)) {
      mostRewatched = { name: nameById.get(tid) ?? 'Unknown', times };
    }
  }

  // Top people: count distinct watched titles per director / actor.
  const directorCounts = new Map<string, number>();
  const actorCounts = new Map<string, number>();
  if (distinctIds.length > 0) {
    const data = await fetchAllIn('credits', 'job, person:people(name)', distinctIds);
    for (const row of data ?? []) {
      const name = (row as any).person?.name as string | undefined;
      if (!name) continue;
      const target = (row as any).job === 'Director' ? directorCounts : actorCounts;
      target.set(name, (target.get(name) ?? 0) + 1);
    }
  }

  // Media split (distinct watched titles) + top networks (distinct watched TV).
  let movieTitles = 0;
  let tvTitles = 0;
  const tvDistinctIds: string[] = [];
  for (const [id, meta] of titleMeta) {
    if (meta.media_type === 'tv') {
      tvTitles++;
      tvDistinctIds.push(id);
    } else if (meta.media_type === 'movie') {
      movieTitles++;
    }
  }

  const networkCounts = new Map<string, number>();
  if (tvDistinctIds.length > 0) {
    const data = await fetchAllIn('title_networks', 'network:networks(name)', tvDistinctIds);
    for (const row of data ?? []) {
      const name = (row as any).network?.name as string | undefined;
      if (name) networkCounts.set(name, (networkCounts.get(name) ?? 0) + 1);
    }
  }

  // Library status breakdown.
  const statusCounts = new Map<string, number>();
  {
    const { data, error } = await supabase
      .from('library_items')
      .select('status')
      .eq('user_id', uid);
    if (error) throw error;
    for (const row of data ?? []) {
      const s = (row as any).status as string;
      statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
    }
  }
  const libraryStatus = LIBRARY_STATUSES.map(({ value, label }) => ({
    label,
    count: statusCounts.get(value) ?? 0,
  })).filter((s) => s.count > 0);

  // Decades + languages (per distinct title).
  const decadeCounts = new Map<number, number>();
  const langCounts = new Map<string, number>();
  for (const meta of titleMeta.values()) {
    if (meta.release_date) {
      const y = new Date(meta.release_date).getFullYear();
      if (!Number.isNaN(y)) {
        const dec = Math.floor(y / 10) * 10;
        decadeCounts.set(dec, (decadeCounts.get(dec) ?? 0) + 1);
      }
    }
    if (meta.original_language) {
      langCounts.set(
        meta.original_language,
        (langCounts.get(meta.original_language) ?? 0) + 1,
      );
    }
  }

  // Ratings.
  const values = (ratingsRes.data ?? []).map((r: any) => r.value as number);
  const distribution = new Array(11).fill(0);
  for (const v of values) if (v >= 1 && v <= 10) distribution[v]++;
  const average =
    values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;

  // Last 12 months series.
  const monthly: { label: string; count: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly.push({
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      count: monthCounts.get(key) ?? 0,
    });
  }

  // Watch patterns (all from watched_at).
  const weekdayCounts = new Array(7).fill(0);
  const dayCounts = new Map<string, number>();
  for (const w of all) {
    const d = new Date(w.watched_at);
    weekdayCounts[d.getDay()]++;
    const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const k = dayKey(local);
    dayCounts.set(k, (dayCounts.get(k) ?? 0) + 1);
  }

  const busiestWeekday =
    all.length > 0 ? WEEKDAYS[weekdayCounts.indexOf(Math.max(...weekdayCounts))] : null;

  let biggestDayRaw: { key: string; count: number } | null = null;
  for (const [k, v] of dayCounts) {
    if (!biggestDayRaw || v > biggestDayRaw.count) biggestDayRaw = { key: k, count: v };
  }
  const biggestDay = biggestDayRaw
    ? {
        label: new Date(biggestDayRaw.key).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
        count: biggestDayRaw.count,
      }
    : null;

  // Streaks over distinct watch days (consecutive calendar days).
  const sortedDays = [...dayCounts.keys()].sort();
  const daySet = new Set(sortedDays);
  let longestStreak = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of sortedDays) {
    const d = new Date(k);
    if (prev && Math.round((d.getTime() - prev.getTime()) / 86400000) === 1) run++;
    else run = 1;
    if (run > longestStreak) longestStreak = run;
    prev = d;
  }
  let currentStreak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!daySet.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1); // allow "yesterday"
  while (daySet.has(dayKey(cursor))) {
    currentStreak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  let busiestMonthRaw: { key: string; count: number } | null = null;
  for (const [k, v] of monthCounts) {
    if (!busiestMonthRaw || v > busiestMonthRaw.count) busiestMonthRaw = { key: k, count: v };
  }
  const busiestMonth = busiestMonthRaw
    ? {
        label: new Date(`${busiestMonthRaw.key}-01`).toLocaleDateString(undefined, {
          month: 'short',
          year: 'numeric',
        }),
        count: busiestMonthRaw.count,
      }
    : null;

  const sortDesc = <T,>(m: Map<T, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]);

  return {
    totalMovieWatches: movieWatches.length,
    totalEpisodeWatches: episodeWatches.length,
    totalMinutes,
    distinctTitles: distinctIds.length,
    thisYear: { minutes: tyMinutes, movies: tyMovies, episodes: tyEpisodes },
    rating: { count: values.length, average, distribution },
    topGenres: sortDesc(genreCounts)
      .slice(0, 8)
      .map(([name, count]) => ({ name, count })),
    topDirectors: sortDesc(directorCounts)
      .slice(0, 6)
      .map(([name, count]) => ({ name, count })),
    topActors: sortDesc(actorCounts)
      .slice(0, 6)
      .map(([name, count]) => ({ name, count })),
    ratingByGenre: [...genreRating.entries()]
      .map(([name, { sum, count }]) => ({ name, avg: sum / count }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 6),
    topRated,
    mostRewatched,
    mediaSplit: { movies: movieTitles, tv: tvTitles },
    libraryStatus,
    topNetworks: sortDesc(networkCounts)
      .slice(0, 6)
      .map(([name, count]) => ({ name, count })),
    decades: [...decadeCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dec, count]) => ({ label: `${dec}s`, count })),
    languages: sortDesc(langCounts)
      .slice(0, 6)
      .map(([label, count]) => ({ label: label.toUpperCase(), count })),
    monthly,
    patterns: {
      busiestWeekday,
      biggestDay,
      currentStreak,
      longestStreak,
      busiestMonth,
    },
  };
}
