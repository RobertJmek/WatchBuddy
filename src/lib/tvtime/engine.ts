// The import orchestrator: resolves every title against TMDB, then writes the
// user's history in the CLI's phase order (shows → episode watches → rewatches
// → movies → favorites).
//
// Catalog writes happen server-side as a side effect of getTitle/fetchSeason
// (the tmdb-proxy caches with the service role); this module only ever writes
// the viewer's own rows, via ./db.
//
// Safe to cancel/kill mid-run: a re-run prefetches the dedupe state fresh and
// skips everything already inserted. Never allow two concurrent runs — with no
// unique constraints on the watch tables, overlap would duplicate rows.

import { fetchSeason, findByExternalId, getTitle } from '@/lib/tmdb';
import type { TitleRow } from '@/lib/tmdb';
import { setFavorite } from '@/lib/library';

import {
  insertEpisodeWatches,
  insertMovieWatch,
  movieAtKey,
  prefetchEpisodeWatchState,
  prefetchLibrary,
  prefetchMovieWatchState,
  setLibraryStatusIfAbsent,
  toIsoTimestamp,
} from './db';
import type { WatchInsert } from './db';
import { movieKey, resolveMovie, resolveShow } from './resolve';
import { inferStatus } from './status';
import type {
  ImportPlan,
  ImportProgress,
  ImportSummary,
  MatchOverride,
  UnresolvedItem,
} from './types';

export class ImportCancelled extends Error {
  constructor() {
    super('Import cancelled');
    this.name = 'ImportCancelled';
  }
}

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

/** Run `fn` over `items` with a small worker pool, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Resolution (runs before any writes; feeds the manual-match queue)
// ---------------------------------------------------------------------------

export type Resolution = {
  /** nameKey → match, for every show that resolved. */
  shows: Map<string, MatchOverride>;
  /** movieKey(name) → match, for every movie (incl. favorites) that resolved. */
  movies: Map<string, MatchOverride>;
  /** favorite-show TVDB id → match. */
  favoriteShows: Map<string, MatchOverride>;
  unresolved: UnresolvedItem[];
};

export type ResolveProgress = { done: number; total: number; label: string };

/**
 * Resolve every show and movie in the plan against TMDB. Read-only (the
 * proxy's search/find actions don't cache), so it can run before the user
 * confirms anything.
 */
export async function resolveAll(
  plan: ImportPlan,
  overrides: ReadonlyMap<string, MatchOverride>,
  opts: { onProgress?: (p: ResolveProgress) => void; signal?: AbortSignal } = {},
): Promise<Resolution> {
  const { onProgress, signal } = opts;

  // Unique movie names: watch/rewatch/towatch records ∪ favorite movies.
  const movieNames = new Map<string, { name: string; year: string | null }>();
  for (const m of plan.movies) {
    if (!movieNames.has(movieKey(m.name))) {
      movieNames.set(movieKey(m.name), { name: m.name, year: m.year });
    }
  }
  for (const uuid of plan.favoriteMovieUuids) {
    const name = plan.movieNameByUuid.get(uuid);
    if (name && !movieNames.has(movieKey(name))) {
      movieNames.set(movieKey(name), { name, year: null });
    }
  }

  // Favorite shows not already covered by an identity with the same TVDB id.
  const knownTvdb = new Set(plan.shows.map((s) => s.tvdbId).filter(Boolean));
  const extraFavTvdb = [...new Set(plan.favoriteShowTvdbIds)].filter(
    (id) => !knownTvdb.has(id),
  );

  const total = plan.shows.length + movieNames.size + extraFavTvdb.length;
  let done = 0;
  const tick = (label: string) => onProgress?.({ done: ++done, total, label });

  const resolution: Resolution = {
    shows: new Map(),
    movies: new Map(),
    favoriteShows: new Map(),
    unresolved: [],
  };

  await mapWithConcurrency(plan.shows, 3, async (identity) => {
    throwIfAborted(signal);
    const match = await withRetry(() => resolveShow(identity, overrides), signal).catch(
      () => null,
    );
    if (match) resolution.shows.set(identity.nameKey, match);
    else {
      resolution.unresolved.push({
        kind: 'show',
        key: identity.nameKey,
        displayName: identity.displayName,
        year: null,
      });
    }
    tick(identity.displayName);
  });

  const movieEntries = [...movieNames.values()];
  await mapWithConcurrency(movieEntries, 3, async ({ name, year }) => {
    throwIfAborted(signal);
    const match = await withRetry(() => resolveMovie(name, year, overrides), signal).catch(
      () => null,
    );
    if (match) resolution.movies.set(movieKey(name), match);
    else {
      resolution.unresolved.push({
        kind: 'movie',
        key: movieKey(name),
        displayName: name,
        year,
      });
    }
    tick(name);
  });

  await mapWithConcurrency(extraFavTvdb, 3, async (tvdbId) => {
    throwIfAborted(signal);
    const results = await withRetry(() => findByExternalId(tvdbId), signal).catch(
      () => [],
    );
    const tv = results.find((r) => r.media_type === 'tv');
    if (tv) resolution.favoriteShows.set(tvdbId, { tmdbId: tv.tmdb_id, mediaType: 'tv' });
    tick(`favorite ${tvdbId}`);
  });
  // Favorite shows that ARE identities resolve through resolution.shows.
  for (const s of plan.shows) {
    if (s.tvdbId && plan.favoriteShowTvdbIds.includes(s.tvdbId)) {
      const match = resolution.shows.get(s.nameKey);
      if (match) resolution.favoriteShows.set(s.tvdbId, match);
    }
  }

  return resolution;
}

// ---------------------------------------------------------------------------
// Import (writes)
// ---------------------------------------------------------------------------

export type RunOptions = {
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
};

export async function runImport(
  plan: ImportPlan,
  resolution: Resolution,
  opts: RunOptions = {},
): Promise<ImportSummary> {
  const { onProgress, signal } = opts;
  const progress = (p: ImportProgress) => onProgress?.(p);

  const summary: ImportSummary = {
    showsImported: 0,
    showsSkipped: 0,
    firstWatchesInserted: 0,
    firstWatchesSkipped: 0,
    firstWatchesUnmatched: 0,
    rewatchesInserted: 0,
    rewatchesSkipped: 0,
    rewatchesUnmatched: 0,
    moviesInserted: 0,
    moviesSkipped: 0,
    favoritesSet: 0,
    skippedTitles: [],
  };

  // --- Prefetch idempotency state (fresh every run) -----------------------
  progress({ phase: 'prefetch', done: 0, total: 3, label: 'Reading your history' });
  const episodeState = await prefetchEpisodeWatchState();
  progress({ phase: 'prefetch', done: 1, total: 3, label: 'Reading your history' });
  const movieState = await prefetchMovieWatchState();
  progress({ phase: 'prefetch', done: 2, total: 3, label: 'Reading your history' });
  const library = await prefetchLibrary();
  progress({ phase: 'prefetch', done: 3, total: 3, label: 'Reading your history' });

  // --- Phase 1: shows → catalog + library ---------------------------------
  // nameKey → catalog entry for the watch phases.
  const catalog = new Map<string, { tmdbId: number; titleId: string; title: TitleRow }>();

  let done = 0;
  await mapWithConcurrency(plan.shows, 3, async (identity) => {
    throwIfAborted(signal);
    const match = resolution.shows.get(identity.nameKey);
    const label = identity.displayName;
    progress({ phase: 'shows', done, total: plan.shows.length, label });
    if (!match) {
      summary.showsSkipped++;
      summary.skippedTitles.push(identity.displayName);
      done++;
      return;
    }
    try {
      const { title } = await withRetry(() => getTitle(match.tmdbId, 'tv'), signal);
      catalog.set(identity.nameKey, { tmdbId: match.tmdbId, titleId: title.id, title });
      await setLibraryStatusIfAbsent(
        library,
        title.id,
        inferStatus(identity.archived, identity.nbSeen, title),
      );
      summary.showsImported++;
    } catch (e) {
      if (e instanceof ImportCancelled) throw e;
      summary.showsSkipped++;
      summary.skippedTitles.push(identity.displayName);
    }
    progress({ phase: 'shows', done: ++done, total: plan.shows.length, label });
  });

  // --- Phase 2: episode watches (grouped per show+season) -----------------
  const bySeason = new Map<string, typeof plan.episodeWatches>();
  for (const w of plan.episodeWatches) {
    const key = `${w.nameKey}|${w.season}`;
    const group = bySeason.get(key);
    if (group) group.push(w);
    else bySeason.set(key, [w]);
  }

  // (nameKey|season) → episode_number → episode uuid, shared with rewatches.
  const seasonCache = new Map<string, Map<number, string>>();
  const loadSeason = async (nameKey: string, season: number) => {
    const key = `${nameKey}|${season}`;
    let map = seasonCache.get(key);
    if (map) return map;
    const entry = catalog.get(nameKey);
    map = new Map<number, string>();
    if (entry) {
      try {
        const episodes = await withRetry(() => fetchSeason(entry.tmdbId, season), signal);
        for (const e of episodes) map.set(e.episode_number, e.id);
      } catch (e) {
        if (e instanceof ImportCancelled) throw e;
        // Season missing on TMDB (specials, renumbering) — episodes unmatched.
      }
    }
    seasonCache.set(key, map);
    return map;
  };

  const groups = [...bySeason.entries()];
  done = 0;
  progress({ phase: 'episodes', done, total: groups.length, label: '' });
  await mapWithConcurrency(groups, 3, async ([key, group]) => {
    throwIfAborted(signal);
    const [nameKey, seasonStr] = key.split('|');
    const season = Number(seasonStr);
    if (!catalog.has(nameKey)) {
      summary.firstWatchesUnmatched += group.length;
      progress({ phase: 'episodes', done: ++done, total: groups.length, label: nameKey });
      return;
    }
    const entry = catalog.get(nameKey)!;
    const epMap = await loadSeason(nameKey, season);
    const batch: WatchInsert[] = [];
    for (const w of group) {
      const epId = epMap.get(w.episode);
      if (!epId) {
        summary.firstWatchesUnmatched++;
        continue;
      }
      if (episodeState.existingFirst.has(epId)) {
        summary.firstWatchesSkipped++;
        continue;
      }
      episodeState.existingFirst.add(epId);
      batch.push({
        episode_id: epId,
        title_id: entry.titleId,
        watched_at: toIsoTimestamp(w.watchedAt),
        is_rewatch: false,
      });
    }
    await insertEpisodeWatches(batch);
    summary.firstWatchesInserted += batch.length;
    progress({
      phase: 'episodes',
      done: ++done,
      total: groups.length,
      label: entry.title.title,
    });
  });

  // --- Phase 3: rewatches -------------------------------------------------
  done = 0;
  for (const rw of plan.rewatches) {
    throwIfAborted(signal);
    progress({ phase: 'rewatches', done, total: plan.rewatches.length, label: rw.nameKey });
    done++;
    const entry = catalog.get(rw.nameKey);
    if (!entry) {
      summary.rewatchesUnmatched += rw.count;
      continue;
    }
    const epMap = await loadSeason(rw.nameKey, rw.season);
    const epId = epMap.get(rw.episode);
    if (!epId) {
      summary.rewatchesUnmatched += rw.count;
      continue;
    }
    const already = episodeState.existingRewatch.get(epId) ?? 0;
    const toAdd = rw.count - already;
    if (toAdd <= 0) {
      summary.rewatchesSkipped += rw.count;
      continue;
    }
    await insertEpisodeWatches(
      Array.from({ length: toAdd }, () => ({
        episode_id: epId,
        title_id: entry.titleId,
        watched_at: toIsoTimestamp(rw.watchedAt),
        is_rewatch: true,
      })),
    );
    episodeState.existingRewatch.set(epId, rw.count);
    summary.rewatchesInserted += toAdd;
  }
  progress({
    phase: 'rewatches',
    done: plan.rewatches.length,
    total: plan.rewatches.length,
    label: '',
  });

  // --- Phase 4: movies ----------------------------------------------------
  // tmdbId → title uuid, so repeat watches of one movie fetch it once.
  const movieTitleIds = new Map<number, string>();
  done = 0;
  for (const movie of plan.movies) {
    throwIfAborted(signal);
    progress({ phase: 'movies', done, total: plan.movies.length, label: movie.name });
    done++;
    const match = resolution.movies.get(movieKey(movie.name));
    if (!match) {
      summary.moviesSkipped++;
      if (!summary.skippedTitles.includes(movie.name)) {
        summary.skippedTitles.push(movie.name);
      }
      continue;
    }
    try {
      let titleId = movieTitleIds.get(match.tmdbId);
      if (!titleId) {
        const { title } = await withRetry(() => getTitle(match.tmdbId, 'movie'), signal);
        titleId = title.id;
        movieTitleIds.set(match.tmdbId, titleId);
      }
      const watchCount = movieState.countByTitle.get(titleId) ?? 0;

      if (movie.kind === 'towatch') {
        // Don't downgrade a movie that already has a watch on record.
        if (watchCount === 0) {
          await setLibraryStatusIfAbsent(library, titleId, 'watchlist');
        }
        continue;
      }

      // Skip if this exact watch event is already recorded, or — for plain
      // watches — if the movie has any watch row at all.
      const atKey = movieAtKey(titleId, toIsoTimestamp(movie.watchedAt));
      if (movieState.atKeys.has(atKey) || (watchCount > 0 && movie.kind === 'watch')) {
        summary.moviesSkipped++;
        continue;
      }
      await insertMovieWatch({
        title_id: titleId,
        watched_at: toIsoTimestamp(movie.watchedAt),
        is_rewatch: movie.kind === 'rewatch',
      });
      movieState.countByTitle.set(titleId, watchCount + 1);
      movieState.atKeys.add(atKey);
      await setLibraryStatusIfAbsent(library, titleId, 'completed');
      summary.moviesInserted++;
    } catch (e) {
      if (e instanceof ImportCancelled) throw e;
      summary.moviesSkipped++;
      if (!summary.skippedTitles.includes(movie.name)) {
        summary.skippedTitles.push(movie.name);
      }
    }
  }
  progress({ phase: 'movies', done: plan.movies.length, total: plan.movies.length, label: '' });

  // --- Phase 5: favorites -------------------------------------------------
  const favMatches: MatchOverride[] = [];
  for (const tvdbId of new Set(plan.favoriteShowTvdbIds)) {
    const match = resolution.favoriteShows.get(tvdbId);
    if (match) favMatches.push(match);
  }
  for (const uuid of new Set(plan.favoriteMovieUuids)) {
    const name = plan.movieNameByUuid.get(uuid);
    const match = name ? resolution.movies.get(movieKey(name)) : undefined;
    if (match) favMatches.push(match);
  }

  done = 0;
  for (const match of favMatches) {
    throwIfAborted(signal);
    progress({ phase: 'favorites', done, total: favMatches.length, label: '' });
    done++;
    try {
      const { title } = await withRetry(() => getTitle(match.tmdbId, match.mediaType), signal);
      // Mirror the CLI: only flag titles already in the library.
      if (library.has(title.id)) {
        await setFavorite(title.id, true);
        summary.favoritesSet++;
      }
    } catch (e) {
      if (e instanceof ImportCancelled) throw e;
    }
  }
  progress({ phase: 'favorites', done: favMatches.length, total: favMatches.length, label: '' });

  return summary;
}
