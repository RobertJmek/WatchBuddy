// Pure parsing of a TV Time GDPR export — no IO beyond the bytes handed in.
// Ports the row filters of scripts/import_tvtime.py exactly; see that script
// (and scripts/import_tvtime.md) for the semantics of each file.

import { unzip } from 'fflate';
import Papa from 'papaparse';

import type {
  EpisodeWatchRecord,
  ExportFiles,
  ImportPlan,
  MovieRecord,
  RewatchRecord,
  ShowIdentity,
} from './types';

/**
 * Unzip the GDPR export and decode every CSV as UTF-8, keyed by basename —
 * the files may sit at the ZIP root or under a `gdpr-data/` folder.
 */
export function unzipExport(bytes: Uint8Array): Promise<ExportFiles> {
  return new Promise((resolve, reject) => {
    unzip(
      bytes,
      { filter: (f) => f.name.endsWith('.csv') },
      (err, unzipped) => {
        if (err) return reject(err);
        const decoder = new TextDecoder('utf-8');
        const files: ExportFiles = new Map();
        for (const [path, data] of Object.entries(unzipped)) {
          const basename = path.split('/').pop()!;
          if (basename) files.set(basename, decoder.decode(data));
        }
        resolve(files);
      },
    );
  });
}

type Row = Record<string, string>;

function rows(files: ExportFiles, name: string): Row[] {
  const text = files.get(name);
  if (!text) return [];
  const parsed = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data;
}

/** A required file's rows, or throw with a user-facing message. */
function requireRows(files: ExportFiles, name: string): Row[] {
  if (!files.has(name)) {
    throw new Error(`The ZIP doesn't look like a TV Time export — missing ${name}`);
  }
  return rows(files, name);
}

/** Parse a positive-ish integer field; null when absent or malformed. */
function int(v: string | undefined): number | null {
  if (!v?.trim()) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * Build the full import plan from the export's CSVs. Derives the complete
 * show-identity set up front (followed ∪ tracked ∪ rewatched) so resolution
 * and manual matching can run once, before any writes.
 */
export function buildImportPlan(files: ExportFiles): ImportPlan {
  const followed = requireRows(files, 'followed_tv_show.csv');

  const seenByTvdb = new Map<string, number>();
  for (const r of rows(files, 'user_tv_show_data.csv')) {
    if (r.tv_show_id) seenByTvdb.set(r.tv_show_id, int(r.nb_episodes_seen) ?? 0);
  }

  // v2 tracking: only watch-episode rows with both numbers are first-watches.
  const episodeWatches: EpisodeWatchRecord[] = [];
  for (const r of rows(files, 'tracking-prod-records-v2.csv')) {
    if (!r.key?.startsWith('watch-episode')) continue;
    const season = int(r.season_number);
    const episode = int(r.episode_number);
    if (season == null || episode == null || !r.series_name) continue;
    episodeWatches.push({
      nameKey: r.series_name.toLowerCase(),
      season,
      episode,
      watchedAt: r.created_at,
    });
  }

  const rewatches: RewatchRecord[] = [];
  for (const r of rows(files, 'rewatched_episode.csv')) {
    const season = int(r.episode_season_number);
    const episode = int(r.episode_number);
    if (season == null || episode == null || !r.tv_show_name) continue;
    rewatches.push({
      nameKey: r.tv_show_name.toLowerCase(),
      season,
      episode,
      watchedAt: r.created_at,
      count: int(r.cpt) ?? 1,
    });
  }

  // Movies live in the older v1 tracking file (v2 has none).
  const movies: MovieRecord[] = [];
  const movieNameByUuid = new Map<string, string>();
  for (const r of rows(files, 'tracking-prod-records.csv')) {
    const name = (r.movie_name ?? '').trim();
    if (r.uuid && name) movieNameByUuid.set(r.uuid, name);
    const isMovie = r.entity_type === 'movie' || !!name;
    const kind = r.type as MovieRecord['kind'];
    if (!isMovie || !['watch', 'rewatch', 'towatch'].includes(kind)) continue;
    if (!name) continue;
    const year = (r.release_date ?? '').slice(0, 4);
    movies.push({
      name,
      year: /^\d{4}$/.test(year) && year !== '1970' ? year : null,
      kind,
      watchedAt: r.created_at,
    });
  }

  // Episode watches per show — also the floor for status inference, since
  // nb_episodes_seen can lag the tracking file.
  const watchCounts = new Map<string, number>();
  for (const w of episodeWatches) {
    watchCounts.set(w.nameKey, (watchCounts.get(w.nameKey) ?? 0) + 1);
  }

  const shows: ShowIdentity[] = [];
  const known = new Set<string>();
  for (const r of followed) {
    const name = r.tv_show_name;
    if (!name) continue;
    const nameKey = name.toLowerCase();
    if (known.has(nameKey)) continue;
    known.add(nameKey);
    shows.push({
      nameKey,
      displayName: name,
      tvdbId: r.tv_show_id || null,
      archived: r.archived === '1',
      nbSeen: Math.max(
        r.tv_show_id ? (seenByTvdb.get(r.tv_show_id) ?? 0) : 0,
        watchCounts.get(nameKey) ?? 0,
      ),
      followed: true,
    });
  }
  // Shows watched or rewatched without being followed still need resolving.
  const extra = [
    ...episodeWatches.map((w) => w.nameKey),
    ...rewatches.map((w) => w.nameKey),
  ];
  for (const nameKey of extra) {
    if (known.has(nameKey)) continue;
    known.add(nameKey);
    shows.push({
      nameKey,
      displayName: nameKey,
      tvdbId: null,
      archived: false,
      nbSeen: watchCounts.get(nameKey) ?? 0,
      followed: false,
    });
  }

  // Favorites: shows as TVDB ids, movies as uuids into the v1 tracking file.
  const favoriteShowTvdbIds: string[] = [];
  const favoriteMovieUuids: string[] = [];
  for (const r of rows(files, 'lists-prod-lists.csv')) {
    const objs = r.objects ?? '';
    if (r.s_key === 'favorite-series') {
      favoriteShowTvdbIds.push(...(objs.match(/\bid:(\d+)/g) ?? []).map((m) => m.slice(3)));
    } else if (r.s_key === 'favorite-movies') {
      favoriteMovieUuids.push(
        ...(objs.match(/\buuid:[0-9a-f-]{36}/g) ?? []).map((m) => m.slice(5)),
      );
    }
  }

  return {
    shows,
    episodeWatches,
    rewatches,
    movies,
    favoriteShowTvdbIds,
    favoriteMovieUuids,
    movieNameByUuid,
  };
}
