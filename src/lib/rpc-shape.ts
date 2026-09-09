import type { FeedItem, FeedRow } from '@/lib/feed';
import type { RawStats } from '@/lib/stats';

/**
 * Shape guards for the two SQL RPCs, kept in their own dependency-free module.
 *
 * Both are called at the data-layer seam, before a payload can reach a screen
 * or the cache. `query.ts` persists the whole TanStack cache to AsyncStorage
 * for seven days, so a malformed response accepted once keeps crashing every
 * cold open long after the server is fixed — that is exactly how the Hot
 * section broke in v1.16.0. A throw is a state the screens already render and
 * never reaches the cache; a guard inside a component would store the garbage
 * instead.
 *
 * Nothing here imports the Supabase client, so the module runs (and can be
 * exercised) on its own — the type imports are erased at build time.
 */

const FEED_TYPES: ReadonlySet<string> = new Set<FeedItem['type']>([
  'episode_watch',
  'movie_watch',
  'rating',
  'review',
  'follow',
  'like',
  'reply',
]);

/** Every row the `get_feed` RPC returned, or a throw naming what was wrong. */
export function parseFeedRows(data: unknown): FeedRow[] {
  // An empty result set legitimately comes back as null from PostgREST.
  if (data == null) return [];
  if (!Array.isArray(data)) throw new Error('get_feed returned an unexpected shape');
  for (const row of data) {
    if (!row || typeof row !== 'object') {
      throw new Error('get_feed returned a malformed row');
    }
    const r = row as Record<string, unknown>;
    if (typeof r.type !== 'string' || !FEED_TYPES.has(r.type)) {
      throw new Error(`get_feed returned an unknown event type: ${String(r.type)}`);
    }
    if (typeof r.actor_id !== 'string' || typeof r.created_at !== 'string') {
      throw new Error('get_feed returned a row without an actor or a timestamp');
    }
  }
  return data as FeedRow[];
}

/**
 * The `get_stats` payload, or a throw naming what was wrong. Only the fields
 * `formatStats` actually dereferences are checked: a missing scalar would
 * render as a wrong number, a missing array throws on `.map`.
 */
export function parseRawStats(data: unknown): RawStats {
  const fail = (what: string): never => {
    throw new Error(`get_stats returned an unexpected shape: ${what}`);
  };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail('not an object');
  }
  const raw = data as Record<string, unknown>;

  const numbers = [
    'distinctTitles',
    'totalMovieWatches',
    'totalEpisodeWatches',
    'totalMinutes',
  ];
  for (const key of numbers) {
    if (typeof raw[key] !== 'number') fail(`${key} is not a number`);
  }

  const objects = ['thisYear', 'mediaSplit', 'rating', 'patterns'];
  for (const key of objects) {
    const v = raw[key];
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${key} is not an object`);
  }

  const arrays = [
    'topGenres',
    'topDirectors',
    'topActors',
    'ratingByGenre',
    'topRated',
    'libraryStatus',
    'topNetworks',
    'decades',
    'languages',
    'monthly',
  ];
  for (const key of arrays) {
    if (!Array.isArray(raw[key])) fail(`${key} is not a list`);
  }

  if (!Array.isArray((raw.rating as Record<string, unknown>).distribution)) {
    fail('rating.distribution is not a list');
  }

  return raw as unknown as RawStats;
}
