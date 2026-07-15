import { supabase } from '@/lib/supabase';

export const TMDB_IMAGE = 'https://image.tmdb.org/t/p';

/** Build a full poster/still URL from a TMDB path, or null. */
export function imageUrl(path: string | null, size = 'w342'): string | null {
  return path ? `${TMDB_IMAGE}/${size}${path}` : null;
}

export type MediaType = 'movie' | 'tv';

export type SearchResult = {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  overview: string;
  poster_path: string | null;
  release_date: string | null;
  vote_average: number | null;
};

export type TitleRow = {
  id: string;
  tmdb_id: number;
  media_type: MediaType;
  imdb_id: string | null;
  title: string;
  overview: string | null;
  release_date: string | null;
  runtime: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  tmdb_rating: number | null;
  imdb_rating: number | null;
  status: string | null;
  number_of_seasons: number | null;
  number_of_episodes: number | null;
};

export type SeasonRow = {
  id: string;
  season_number: number;
  name: string | null;
  episode_count: number | null;
  air_date: string | null;
  poster_path: string | null;
};

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('tmdb-proxy', { body });
  if (error) {
    // supabase-js reports only the HTTP status; the function's JSON `{ error }`
    // body (the useful part) is on error.context — read it when present.
    let message = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const parsed = await ctx.json();
        if (parsed?.error) message = parsed.error;
      } catch {
        // non-JSON body — keep the original message
      }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export function searchTitles(q: string) {
  return invoke<{ results: SearchResult[] }>({ action: 'search', q }).then(
    (d) => d.results,
  );
}

export type TrendingFeed = { movies: SearchResult[]; tv: SearchResult[] };

export function getTrending() {
  return invoke<TrendingFeed>({ action: 'trending' });
}

export function fetchTitle(tmdbId: number, mediaType: MediaType) {
  return invoke<{ title: TitleRow; seasons: SeasonRow[] }>({
    action: 'title',
    tmdb_id: tmdbId,
    media_type: mediaType,
  });
}

// Mirrors the edge function's cache gate (TITLE_CACHE_TTL_HOURS, default 168h).
const TITLE_CACHE_TTL_MS = 168 * 3600_000;

/**
 * Read-through title fetch: serve straight from the Postgres cache when fresh
 * (a fast PostgREST read — no edge-function cold start), falling back to the
 * tmdb-proxy function only for missing/stale rows.
 */
export async function getTitle(
  tmdbId: number,
  mediaType: MediaType,
): Promise<{ title: TitleRow; seasons: SeasonRow[] }> {
  const { data: cached } = await supabase
    .from('titles')
    .select('*')
    .eq('tmdb_id', tmdbId)
    .eq('media_type', mediaType)
    .maybeSingle();

  if (cached) {
    const fresh =
      Date.now() - new Date(cached.cached_at).getTime() < TITLE_CACHE_TTL_MS;
    // Same backfill rule as the server: a row with a known imdb_id but no
    // rating yet should go through the function so OMDb can fill it in.
    const couldBackfillImdb = !!cached.imdb_id && cached.imdb_rating == null;
    if (fresh && !couldBackfillImdb) {
      if (mediaType !== 'tv') return { title: cached, seasons: [] };
      const { data: seasons } = await supabase
        .from('seasons')
        .select('*')
        .eq('title_id', cached.id)
        .order('season_number');
      return { title: cached, seasons: seasons ?? [] };
    }
  }

  return fetchTitle(tmdbId, mediaType);
}

/**
 * Shared React Query options for title details, so the detail screen and
 * poster prefetches hit the same cache entry.
 */
export function titleQueryOptions(tmdbId: number, mediaType: MediaType) {
  return {
    queryKey: ['title', mediaType, tmdbId] as const,
    queryFn: () => getTitle(tmdbId, mediaType),
    staleTime: 60 * 60 * 1000, // in-memory hour; the DB cache covers the rest
  };
}

export type EpisodeRow = {
  id: string;
  title_id: string;
  season_number: number;
  episode_number: number;
  name: string | null;
  overview: string | null;
  runtime: number | null;
  air_date: string | null;
  still_path: string | null;
};

export function fetchSeason(tmdbId: number, seasonNumber: number) {
  return invoke<{ episodes: EpisodeRow[] }>({
    action: 'season',
    tmdb_id: tmdbId,
    season_number: seasonNumber,
  }).then((d) => d.episodes);
}

/** Fetch (and cache) every episode across the given season numbers. */
export async function fetchAllEpisodes(
  tmdbId: number,
  seasonNumbers: number[],
): Promise<EpisodeRow[]> {
  const perSeason = await Promise.all(
    seasonNumbers.map((n) => fetchSeason(tmdbId, n)),
  );
  return perSeason.flat();
}
