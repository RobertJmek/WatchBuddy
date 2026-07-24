// The WatchBuddy-export importer: resolve every referenced TMDB title to a local
// catalog id, then write the viewer's watch history in two phases (episodes →
// movies). Because the export carries exact tmdb_ids, resolution is a plain TMDB
// fetch per title — no fuzzy matching, no manual-match queue.
//
// Catalog writes happen server-side as a side effect of getTitle/fetchSeason
// (the tmdb-proxy caches with the service role); this module only ever writes
// the viewer's own rows, via ./db.
//
// Safe to cancel/kill mid-run: a re-run prefetches the dedupe state fresh and
// skips everything already inserted. Never allow two concurrent runs — with no
// unique constraints on the watch tables, overlap would duplicate rows.

import { fetchSeason, getTitle } from '@/lib/tmdb';
import { ImportCancelled } from '@/lib/tvtime/engine';

import {
  episodeRewatchAtKey,
  insertEpisodeWatches,
  insertMovieWatch,
  movieAtKey,
  prefetchEpisodeRewatchAtKeys,
  prefetchEpisodeWatchState,
  prefetchMovieWatchState,
} from './db';
import type { WatchInsert } from './db';
import type {
  EpisodeWatchPlan,
  WbImportPlan,
  WbImportProgress,
  WbImportSummary,
  WbResolveProgress,
} from './types';

export { ImportCancelled };

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ImportCancelled();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry transient proxy failures (cold starts, network blips). */
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let delay = 1000;
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(signal);
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ImportCancelled || attempt >= 2) throw e;
      await sleep(delay);
      delay *= 3;
    }
  }
}

/** Run `fn` over `items` with a small worker pool. */
async function forEachWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Resolution (runs before any writes)
// ---------------------------------------------------------------------------

/** `${mediaType}:${tmdbId}` → local catalog title id. */
export type WbResolution = {
  titleIdByTmdb: Map<string, string>;
  /** Distinct titles that failed to resolve on TMDB. */
  unresolved: number;
};

const tvKey = (tmdbId: number) => `tv:${tmdbId}`;
const movieKey = (tmdbId: number) => `movie:${tmdbId}`;

/**
 * Resolve every distinct show/movie in the plan to a local catalog id via TMDB.
 * getTitle caches the catalog server-side, so this warms every title the writes
 * below will reference.
 */
export async function resolvePlan(
  plan: WbImportPlan,
  opts: { onProgress?: (p: WbResolveProgress) => void; signal?: AbortSignal } = {},
): Promise<WbResolution> {
  const { onProgress, signal } = opts;

  const refs: { tmdbId: number; mediaType: 'movie' | 'tv' }[] = [];
  const seen = new Set<string>();
  const add = (tmdbId: number, mediaType: 'movie' | 'tv') => {
    const key = `${mediaType}:${tmdbId}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ tmdbId, mediaType });
    }
  };
  for (const w of plan.episodeWatches) add(w.tmdbId, 'tv');
  for (const w of plan.movieWatches) add(w.tmdbId, 'movie');

  const resolution: WbResolution = { titleIdByTmdb: new Map(), unresolved: 0 };
  let done = 0;
  await forEachWithConcurrency(refs, 3, async ({ tmdbId, mediaType }) => {
    throwIfAborted(signal);
    try {
      const { title } = await withRetry(() => getTitle(tmdbId, mediaType), signal);
      resolution.titleIdByTmdb.set(`${mediaType}:${tmdbId}`, title.id);
    } catch (e) {
      if (e instanceof ImportCancelled) throw e;
      resolution.unresolved++;
    }
    onProgress?.({ done: ++done, total: refs.length, label: String(tmdbId) });
  });

  return resolution;
}

// ---------------------------------------------------------------------------
// Import (writes)
// ---------------------------------------------------------------------------

export type RunOptions = {
  onProgress?: (p: WbImportProgress) => void;
  signal?: AbortSignal;
};

export async function runImport(
  plan: WbImportPlan,
  resolution: WbResolution,
  opts: RunOptions = {},
): Promise<WbImportSummary> {
  const { onProgress, signal } = opts;
  const progress = (p: WbImportProgress) => onProgress?.(p);

  const summary: WbImportSummary = {
    episodeWatchesInserted: 0,
    episodeWatchesSkipped: 0,
    episodeWatchesUnmatched: 0,
    movieWatchesInserted: 0,
    movieWatchesSkipped: 0,
    titlesUnresolved: resolution.unresolved,
  };

  // --- Prefetch idempotency state (fresh every run) -----------------------
  progress({ phase: 'prefetch', done: 0, total: 3, label: 'Reading your history' });
  const episodeState = await prefetchEpisodeWatchState();
  progress({ phase: 'prefetch', done: 1, total: 3, label: 'Reading your history' });
  const rewatchAtKeys = await prefetchEpisodeRewatchAtKeys();
  progress({ phase: 'prefetch', done: 2, total: 3, label: 'Reading your history' });
  const movieState = await prefetchMovieWatchState();
  progress({ phase: 'prefetch', done: 3, total: 3, label: 'Reading your history' });

  // --- Phase 1: episode watches (grouped per show + season) ---------------
  const bySeason = new Map<string, EpisodeWatchPlan[]>();
  for (const w of plan.episodeWatches) {
    const key = `${w.tmdbId}|${w.season}`;
    const group = bySeason.get(key);
    if (group) group.push(w);
    else bySeason.set(key, [w]);
  }

  const groups = [...bySeason.entries()];
  let done = 0;
  progress({ phase: 'episodes', done, total: groups.length, label: '' });
  await forEachWithConcurrency(groups, 3, async ([key, group]) => {
    throwIfAborted(signal);
    const [tmdbStr, seasonStr] = key.split('|');
    const tmdbId = Number(tmdbStr);
    const season = Number(seasonStr);
    const titleId = resolution.titleIdByTmdb.get(tvKey(tmdbId));
    if (!titleId) {
      summary.episodeWatchesUnmatched += group.length;
      progress({ phase: 'episodes', done: ++done, total: groups.length, label: '' });
      return;
    }

    // episode_number → local episode id.
    let epMap = new Map<number, string>();
    try {
      const episodes = await withRetry(() => fetchSeason(tmdbId, season), signal);
      epMap = new Map(episodes.map((e) => [e.episode_number, e.id]));
    } catch (e) {
      if (e instanceof ImportCancelled) throw e;
      // Season missing on TMDB (specials, renumbering) — its watches go unmatched.
    }

    const batch: WatchInsert[] = [];
    for (const w of group) {
      const epId = epMap.get(w.episode);
      if (!epId) {
        summary.episodeWatchesUnmatched++;
        continue;
      }
      if (w.isRewatch) {
        const atKey = episodeRewatchAtKey(epId, w.watchedAt);
        if (rewatchAtKeys.has(atKey)) {
          summary.episodeWatchesSkipped++;
          continue;
        }
        rewatchAtKeys.add(atKey);
      } else {
        if (episodeState.existingFirst.has(epId)) {
          summary.episodeWatchesSkipped++;
          continue;
        }
        episodeState.existingFirst.add(epId);
      }
      batch.push({
        episode_id: epId,
        title_id: titleId,
        watched_at: w.watchedAt,
        is_rewatch: w.isRewatch,
      });
    }
    await insertEpisodeWatches(batch);
    summary.episodeWatchesInserted += batch.length;
    progress({ phase: 'episodes', done: ++done, total: groups.length, label: '' });
  });

  // --- Phase 2: movie watches --------------------------------------------
  done = 0;
  progress({ phase: 'movies', done, total: plan.movieWatches.length, label: '' });
  for (const w of plan.movieWatches) {
    throwIfAborted(signal);
    done++;
    const titleId = resolution.titleIdByTmdb.get(movieKey(w.tmdbId));
    if (!titleId) {
      summary.movieWatchesSkipped++;
      continue;
    }
    const atKey = movieAtKey(titleId, w.watchedAt);
    if (movieState.atKeys.has(atKey)) {
      summary.movieWatchesSkipped++;
      progress({ phase: 'movies', done, total: plan.movieWatches.length, label: '' });
      continue;
    }
    await insertMovieWatch({
      title_id: titleId,
      watched_at: w.watchedAt,
      is_rewatch: w.isRewatch,
    });
    movieState.atKeys.add(atKey);
    summary.movieWatchesInserted++;
    progress({ phase: 'movies', done, total: plan.movieWatches.length, label: '' });
  }

  return summary;
}
