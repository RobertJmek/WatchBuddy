import type { MediaType } from '@/lib/tmdb';

/** CSV contents of the GDPR export, keyed by file basename. */
export type ExportFiles = Map<string, string>;

/**
 * One show mentioned anywhere in the export. Derived up front (followed shows
 * ∪ names seen only in tracking/rewatch files) so TMDB resolution and manual
 * matching happen once, before any writes.
 */
export type ShowIdentity = {
  /** Lowercased TV Time name — the join key across the export's files. */
  nameKey: string;
  displayName: string;
  /** TVDB id — only followed shows carry one. */
  tvdbId: string | null;
  archived: boolean;
  /** max(nb_episodes_seen, tracked-watch count) — the CLI's status floor. */
  nbSeen: number;
  followed: boolean;
};

export type EpisodeWatchRecord = {
  nameKey: string;
  season: number;
  episode: number;
  /** TV Time timestamp, "YYYY-MM-DD HH:MM:SS" (UTC). */
  watchedAt: string;
};

export type RewatchRecord = {
  nameKey: string;
  season: number;
  episode: number;
  watchedAt: string;
  /** Total rewatch count for this episode (`cpt`). */
  count: number;
};

export type MovieRecord = {
  name: string;
  /** Release year when usable (4 digits, not the epoch default "1970"). */
  year: string | null;
  kind: 'watch' | 'rewatch' | 'towatch';
  watchedAt: string;
};

/** Everything parsed out of the export, before any TMDB resolution. */
export type ImportPlan = {
  shows: ShowIdentity[];
  episodeWatches: EpisodeWatchRecord[];
  rewatches: RewatchRecord[];
  movies: MovieRecord[];
  favoriteShowTvdbIds: string[];
  favoriteMovieUuids: string[];
  /** v1 tracking uuid → movie name (favorites point at these). */
  movieNameByUuid: Map<string, string>;
};

/** A title the automatic TMDB resolution couldn't place. */
export type UnresolvedItem = {
  kind: 'show' | 'movie';
  /** Identity key: show nameKey, or `movie:{name}` for movies. */
  key: string;
  displayName: string;
  year: string | null;
};

/** The user's manual pick for an unresolved item (or a CLI-style override). */
export type MatchOverride = { tmdbId: number; mediaType: MediaType };

export type ImportPhase =
  | 'prefetch'
  | 'shows'
  | 'episodes'
  | 'rewatches'
  | 'movies'
  | 'favorites';

export type ImportProgress = {
  phase: ImportPhase;
  done: number;
  total: number;
  /** What's being worked on right now (usually a title name). */
  label: string;
};

export type ImportSummary = {
  showsImported: number;
  showsSkipped: number;
  firstWatchesInserted: number;
  firstWatchesSkipped: number;
  firstWatchesUnmatched: number;
  rewatchesInserted: number;
  rewatchesSkipped: number;
  rewatchesUnmatched: number;
  moviesInserted: number;
  moviesSkipped: number;
  favoritesSet: number;
  /** Titles skipped in the manual-match step or that failed mid-import. */
  skippedTitles: string[];
};
