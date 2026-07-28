import type { Genre } from '@/lib/genres';
import type { MyLibraryEntry } from '@/lib/library';

/**
 * The library filter, and the pure functions over it. No supabase, no React,
 * no navigation — the whole thing is data in, data out, so it can be exercised
 * without a device (the same reason `tvtime/parse.ts` and `tvtime/status.ts`
 * are pure).
 *
 * Two rules run through everything here:
 *
 * - **AND, everywhere.** Between axes, and *within* the genre axis: picking
 *   Horror + Thriller asks for titles carrying both, not either. Narrowing
 *   always shrinks the result set, so zero results is a routine outcome the
 *   callers must render an empty state for.
 * - **A full range means the axis is off.** `years`/`rating` are `null` when
 *   inactive, and `normalizeRange` is what turns "the user dragged it back to
 *   both ends" into that null. It matters because an *active* range also
 *   excludes rows that have nothing to compare — an unrated title can't
 *   satisfy "rated 6 to 8", and a title with no release date can't satisfy
 *   "released 1990 to 1999".
 */
export type LibraryFilter = {
  mediaType: 'all' | 'movie' | 'tv';
  /** TMDB genre ids the title must carry *all* of. */
  genreIds: number[];
  /** Inclusive release-year range, or null when the axis is off. */
  years: [number, number] | null;
  /** Inclusive 1–10 own-rating range, or null when the axis is off. */
  rating: [number, number] | null;
};

export type Range = [number, number];

export const EMPTY_FILTER: LibraryFilter = {
  mediaType: 'all',
  genreIds: [],
  years: null,
  rating: null,
};

export const RATING_DOMAIN: Range = [1, 10];

export function isActive(f: LibraryFilter): boolean {
  return (
    f.mediaType !== 'all' ||
    f.genreIds.length > 0 ||
    f.years !== null ||
    f.rating !== null
  );
}

/** The release year of an entry, or null when it has no date. */
export function yearOf(e: MyLibraryEntry): number | null {
  const d = e.title?.release_date;
  if (!d) return null;
  const y = Number(d.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

/**
 * The narrowest year range the library actually spans, so the Year fields open
 * on real numbers instead of offering 1900 to someone whose oldest film is
 * from 1972. Falls back to the current year on an empty/dateless library.
 */
export function yearBounds(entries: MyLibraryEntry[]): Range {
  const years = entries
    .map(yearOf)
    .filter((y): y is number => y !== null);
  if (years.length === 0) {
    const now = new Date().getFullYear();
    return [now, now];
  }
  return [Math.min(...years), Math.max(...years)];
}

/**
 * The genres worth offering as chips, **most-used first**.
 *
 * Two things are folded in here rather than in the sheet. A genre no title
 * carries is dropped — a chip that can only ever return nothing is worse than
 * no chip. And the rest are ordered by how many of *your* titles carry them, so
 * the handful you actually filter by sit at the top, where the sheet shows them
 * before the "Show all" fold. Ties break alphabetically, which is what keeps the
 * long tail (every genre owning one title) in a stable, scannable order.
 *
 * The count is over entries, not titles: a title in the library twice would
 * count twice. It can't be — `library_items` is unique per user+title.
 */
export function genreOptions(
  entries: MyLibraryEntry[],
  genres: Genre[],
): Genre[] {
  const counts = new Map<number, number>();
  for (const e of entries) {
    for (const id of e.genreIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return genres
    .filter((g) => counts.has(g.id))
    .sort(
      (a, b) =>
        (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

/** A range collapsed to null when it covers its whole domain (= axis off). */
export function normalizeRange(value: Range, domain: Range): Range | null {
  const lo = Math.max(domain[0], Math.min(value[0], value[1]));
  const hi = Math.min(domain[1], Math.max(value[0], value[1]));
  if (lo <= domain[0] && hi >= domain[1]) return null;
  return [lo, hi];
}

export function applyFilter(
  entries: MyLibraryEntry[],
  f: LibraryFilter,
): MyLibraryEntry[] {
  if (!isActive(f)) return entries;
  return entries.filter((e) => {
    if (f.mediaType !== 'all' && e.title?.media_type !== f.mediaType) {
      return false;
    }
    if (f.genreIds.length > 0) {
      // AND: every picked genre must be present.
      if (!f.genreIds.every((id) => e.genreIds.includes(id))) return false;
    }
    if (f.years) {
      const y = yearOf(e);
      if (y === null || y < f.years[0] || y > f.years[1]) return false;
    }
    if (f.rating) {
      const r = e.myRating;
      if (r === null || r < f.rating[0] || r > f.rating[1]) return false;
    }
    return true;
  });
}

export type FilterChip = {
  /** Identifies what a tap on the `×` removes — see `removeChip`. */
  key: string;
  label: string;
};

/**
 * The active filter as removable chips. Genres get one chip each (with AND,
 * dropping a single genre is the useful undo — not dropping the whole axis).
 */
export function chipsFor(
  f: LibraryFilter,
  genreNames: Map<number, string>,
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.mediaType !== 'all') {
    chips.push({
      key: 'mediaType',
      label: f.mediaType === 'movie' ? 'Movies' : 'TV',
    });
  }
  for (const id of f.genreIds) {
    chips.push({ key: `genre:${id}`, label: genreNames.get(id) ?? `#${id}` });
  }
  if (f.years) {
    chips.push({
      key: 'years',
      label:
        f.years[0] === f.years[1]
          ? String(f.years[0])
          : `${f.years[0]}–${f.years[1]}`,
    });
  }
  if (f.rating) {
    chips.push({
      key: 'rating',
      label:
        f.rating[0] === f.rating[1]
          ? `Rated ${f.rating[0]}`
          : `Rated ${f.rating[0]}–${f.rating[1]}`,
    });
  }
  return chips;
}

/** The filter with the axis (or single genre) behind `key` switched off. */
export function removeChip(f: LibraryFilter, key: string): LibraryFilter {
  if (key === 'mediaType') return { ...f, mediaType: 'all' };
  if (key === 'years') return { ...f, years: null };
  if (key === 'rating') return { ...f, rating: null };
  if (key.startsWith('genre:')) {
    const id = Number(key.slice('genre:'.length));
    return { ...f, genreIds: f.genreIds.filter((g) => g !== id) };
  }
  return f;
}

function rangeToParam(r: Range): string {
  return `${r[0]}-${r[1]}`;
}

function rangeFromParam(v: string | undefined): Range | null {
  if (!v) return null;
  const [lo, hi] = v.split('-').map(Number);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

/**
 * The router seam. A filter travels from Library into a category as plain
 * string params (and no further — the category's own edits stay there), so it
 * has to survive a round trip through `useLocalSearchParams`. Inactive axes
 * are omitted rather than sent as empty strings.
 */
export function filterToParams(f: LibraryFilter): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.mediaType !== 'all') p.type = f.mediaType;
  if (f.genreIds.length > 0) p.genres = f.genreIds.join(',');
  if (f.years) p.years = rangeToParam(f.years);
  if (f.rating) p.rating = rangeToParam(f.rating);
  return p;
}

export function filterFromParams(p: {
  type?: string;
  genres?: string;
  years?: string;
  rating?: string;
}): LibraryFilter {
  return {
    mediaType: p.type === 'movie' || p.type === 'tv' ? p.type : 'all',
    genreIds: (p.genres ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0),
    years: rangeFromParam(p.years),
    rating: rangeFromParam(p.rating),
  };
}
