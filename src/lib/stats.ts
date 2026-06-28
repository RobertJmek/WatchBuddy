import { supabase } from '@/lib/supabase';

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
  decades: { label: string; count: number }[];
  languages: { label: string; count: number }[];
  monthly: { label: string; count: number }[]; // last 12 months, oldest→newest
};

type TitleMeta = {
  runtime: number | null;
  original_language: string | null;
  release_date: string | null;
};

type WatchRow = {
  watched_at: string;
  title_id: string;
  minutes: number;
  meta: TitleMeta | null;
};

function yearOf(iso: string) {
  return new Date(iso).getFullYear();
}

export async function getStats(): Promise<Stats> {
  const [episodesRes, moviesRes, ratingsRes] = await Promise.all([
    supabase
      .from('episode_watches')
      .select(
        'watched_at, title_id, episode:episodes(runtime), title:titles(runtime, original_language, release_date)',
      ),
    supabase
      .from('movie_watches')
      .select(
        'watched_at, title_id, title:titles(runtime, original_language, release_date)',
      ),
    supabase.from('ratings').select('value'),
  ]);
  if (episodesRes.error) throw episodesRes.error;
  if (moviesRes.error) throw moviesRes.error;
  if (ratingsRes.error) throw ratingsRes.error;

  const episodeWatches: WatchRow[] = (episodesRes.data ?? []).map((r: any) => ({
    watched_at: r.watched_at,
    title_id: r.title_id,
    minutes: r.episode?.runtime ?? r.title?.runtime ?? 0,
    meta: r.title ?? null,
  }));
  const movieWatches: WatchRow[] = (moviesRes.data ?? []).map((r: any) => ({
    watched_at: r.watched_at,
    title_id: r.title_id,
    minutes: r.title?.runtime ?? 0,
    meta: r.title ?? null,
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

  // Genres for the distinct watched titles.
  const genreCounts = new Map<string, number>();
  if (distinctIds.length > 0) {
    const { data, error } = await supabase
      .from('title_genres')
      .select('title_id, genres(name)')
      .in('title_id', distinctIds);
    if (error) throw error;
    for (const row of data ?? []) {
      const name = (row as any).genres?.name as string | undefined;
      if (name) genreCounts.set(name, (genreCounts.get(name) ?? 0) + 1);
    }
  }

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
    decades: [...decadeCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dec, count]) => ({ label: `${dec}s`, count })),
    languages: sortDesc(langCounts)
      .slice(0, 6)
      .map(([label, count]) => ({ label: label.toUpperCase(), count })),
    monthly,
  };
}
