// Types for importing a WatchBuddy export JSON (produced by src/lib/export.ts)
// into the viewer's own account. Only watch history is imported — see ADR / the
// import screen for the scope decision.

/** A single episode watch, normalized to TMDB coordinates. */
export type EpisodeWatchPlan = {
  tmdbId: number;
  season: number;
  episode: number;
  /** ISO timestamp, straight from the export (already timestamptz). */
  watchedAt: string;
  isRewatch: boolean;
};

/** A single movie watch, normalized to a TMDB id. */
export type MovieWatchPlan = {
  tmdbId: number;
  watchedAt: string;
  isRewatch: boolean;
};

/** Everything parsed out of a WatchBuddy export, before any TMDB resolution. */
export type WbImportPlan = {
  episodeWatches: EpisodeWatchPlan[];
  movieWatches: MovieWatchPlan[];
  /** Distinct TMDB shows referenced by the episode watches. */
  showCount: number;
  /** Distinct TMDB movies referenced by the movie watches. */
  movieCount: number;
  /** Rows dropped because their title/episode wasn't in the embedded catalog. */
  unmatchedInExport: number;
};

export type WbImportPhase = 'prefetch' | 'resolve' | 'episodes' | 'movies';

export type WbImportProgress = {
  phase: WbImportPhase;
  done: number;
  total: number;
  /** What's being worked on right now (usually a title name). */
  label: string;
};

export type WbResolveProgress = { done: number; total: number; label: string };

export type WbImportSummary = {
  episodeWatchesInserted: number;
  episodeWatchesSkipped: number;
  /** Episodes that couldn't be matched on TMDB (renumbering, missing season). */
  episodeWatchesUnmatched: number;
  movieWatchesInserted: number;
  movieWatchesSkipped: number;
  /** Titles that failed to resolve on TMDB and were skipped. */
  titlesUnresolved: number;
};
