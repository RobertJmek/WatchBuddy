// Library-status inference + name matching helpers, ported from
// scripts/import_tvtime.py (_infer_status, SHOW_OVERRIDES, _name_variants).

import type { LibraryStatus } from '@/lib/library';
import type { TitleRow } from '@/lib/tmdb';

import type { MatchOverride } from './types';

const ENDED_STATUS = new Set(['Ended', 'Canceled', 'Cancelled']);

/**
 * Infer a library status from TV Time's signals + the resolved TMDB title.
 * Only applied when the user has no library row yet — existing rows win.
 */
export function inferStatus(
  archived: boolean,
  nbSeen: number,
  title: Pick<TitleRow, 'status' | 'number_of_episodes'>,
): LibraryStatus {
  if (archived) return 'dropped';
  if (nbSeen === 0) return 'watchlist';
  const total = title.number_of_episodes ?? 0;
  if (title.status && ENDED_STATUS.has(title.status)) {
    return total && nbSeen >= total ? 'completed' : 'on_hold';
  }
  return 'watching';
}

/**
 * Shows whose TV Time name resolves to the wrong TMDB entry via search,
 * keyed by lowercased TV Time name. The user's manual matches merge on top.
 */
export const SHOW_OVERRIDES: ReadonlyMap<string, MatchOverride> = new Map([
  ['monster (2022)', { tmdbId: 113988, mediaType: 'tv' }], // Dahmer – Monster
]);

/** Search-query variants: the name as-is, then with a trailing "(YYYY)" stripped. */
export function nameVariants(name: string): string[] {
  const variants = [name];
  const cleaned = name.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  if (cleaned && cleaned !== name) variants.push(cleaned);
  return variants;
}
