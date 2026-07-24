// Pure parsing of a WatchBuddy export JSON into a normalized watch-history plan.
//
// The export (src/lib/export.ts) embeds a catalog lookup table alongside the
// user's rows, carrying tmdb_id/media_type per title and season/episode numbers
// per episode. We re-key every watch to those TMDB coordinates so the importer
// never has to trust the raw catalog UUIDs — they get re-resolved server-side.

import type { EpisodeWatchPlan, MovieWatchPlan, WbImportPlan } from './types';

/** The newest export shape this importer understands. */
export const SUPPORTED_SCHEMA_VERSION = 1;

export class WbImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WbImportParseError';
  }
}

type CatalogTitle = { id: string; tmdb_id: number; media_type: 'movie' | 'tv' };
type CatalogEpisode = {
  id: string;
  title_id: string;
  season_number: number;
  episode_number: number;
};

/**
 * Parse a decoded WatchBuddy export into a plan. Throws WbImportParseError with
 * a user-facing message when the file isn't a recognizable WatchBuddy export.
 */
export function parseExport(raw: unknown): WbImportPlan {
  if (!raw || typeof raw !== 'object') {
    throw new WbImportParseError('This file isn’t a WatchBuddy export.');
  }
  const doc = raw as Record<string, any>;

  if (doc.app !== 'WatchBuddy') {
    throw new WbImportParseError('This file isn’t a WatchBuddy export.');
  }
  // Missing schema_version = a legacy export that predates the field; it shares
  // the current shape, so treat it as v0 and accept it.
  const version = doc.schema_version ?? 0;
  if (typeof version !== 'number' || version > SUPPORTED_SCHEMA_VERSION) {
    throw new WbImportParseError(
      'This export was made by a newer version of WatchBuddy. Update the app and try again.',
    );
  }

  const catalog = doc.catalog ?? {};
  const titleById = new Map<string, CatalogTitle>();
  for (const t of (catalog.titles ?? []) as CatalogTitle[]) {
    if (t && t.id) titleById.set(t.id, t);
  }
  const episodeById = new Map<string, CatalogEpisode>();
  for (const e of (catalog.episodes ?? []) as CatalogEpisode[]) {
    if (e && e.id) episodeById.set(e.id, e);
  }

  let unmatchedInExport = 0;

  const episodeWatches: EpisodeWatchPlan[] = [];
  const showTmdbIds = new Set<number>();
  for (const row of (doc.episode_watches ?? []) as any[]) {
    const ep = row?.episode_id ? episodeById.get(row.episode_id) : undefined;
    const title = ep ? titleById.get(ep.title_id) : undefined;
    if (!ep || !title || title.tmdb_id == null || !row.watched_at) {
      unmatchedInExport++;
      continue;
    }
    showTmdbIds.add(title.tmdb_id);
    episodeWatches.push({
      tmdbId: title.tmdb_id,
      season: ep.season_number,
      episode: ep.episode_number,
      watchedAt: row.watched_at,
      isRewatch: !!row.is_rewatch,
    });
  }

  const movieWatches: MovieWatchPlan[] = [];
  const movieTmdbIds = new Set<number>();
  for (const row of (doc.movie_watches ?? []) as any[]) {
    const title = row?.title_id ? titleById.get(row.title_id) : undefined;
    if (!title || title.tmdb_id == null || !row.watched_at) {
      unmatchedInExport++;
      continue;
    }
    movieTmdbIds.add(title.tmdb_id);
    movieWatches.push({
      tmdbId: title.tmdb_id,
      watchedAt: row.watched_at,
      isRewatch: !!row.is_rewatch,
    });
  }

  return {
    episodeWatches,
    movieWatches,
    showCount: showTmdbIds.size,
    movieCount: movieTmdbIds.size,
    unmatchedInExport,
  };
}
