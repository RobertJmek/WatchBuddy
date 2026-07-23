// TMDB resolution for TV Time titles — all IO goes through src/lib/tmdb
// (the tmdb-proxy Edge Function), never TMDB directly.

import { findByExternalId, searchTitles } from '@/lib/tmdb';

import { nameVariants, SHOW_OVERRIDES } from './status';
import type { MatchOverride, ShowIdentity } from './types';

/** Identity key for a movie in the overrides/resolution maps. */
export function movieKey(name: string): string {
  return `movie:${name.toLowerCase()}`;
}

/**
 * Resolve a show: manual pick first, then the curated overrides, then TMDB
 * /find by TVDB id (followed shows carry one), then name search.
 */
export async function resolveShow(
  identity: ShowIdentity,
  overrides: ReadonlyMap<string, MatchOverride>,
): Promise<MatchOverride | null> {
  const manual = overrides.get(identity.nameKey) ?? SHOW_OVERRIDES.get(identity.nameKey);
  if (manual) return manual;

  if (identity.tvdbId) {
    const results = await findByExternalId(identity.tvdbId);
    const tv = results.find((r) => r.media_type === 'tv');
    if (tv) return { tmdbId: tv.tmdb_id, mediaType: 'tv' };
  }
  for (const query of nameVariants(identity.displayName)) {
    const tv = (await searchTitles(query)).find((r) => r.media_type === 'tv');
    if (tv) return { tmdbId: tv.tmdb_id, mediaType: 'tv' };
  }
  return null;
}

/**
 * Resolve a movie by name search, preferring a release-year match when the
 * export provides a usable year.
 */
export async function resolveMovie(
  name: string,
  year: string | null,
  overrides: ReadonlyMap<string, MatchOverride>,
): Promise<MatchOverride | null> {
  const manual = overrides.get(movieKey(name));
  if (manual) return manual;

  for (const query of nameVariants(name)) {
    const movies = (await searchTitles(query)).filter((r) => r.media_type === 'movie');
    if (!movies.length) continue;
    const byYear = year && movies.find((r) => r.release_date?.startsWith(year));
    const pick = byYear || movies[0];
    return { tmdbId: pick.tmdb_id, mediaType: 'movie' };
  }
  return null;
}
