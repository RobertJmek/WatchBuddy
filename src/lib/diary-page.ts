/**
 * The Diary's pure half: merging one page from the two watch tables, and
 * grouping watches into entries. No runtime imports, so it can be exercised
 * on its own.
 */

export type DiaryEntry = {
  id: string;
  kind: 'movie' | 'episode';
  watched_at: string;
  titleName: string;
  posterPath: string | null;
  subtitle: string | null;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  /** Underlying watch rows (1 for movies, N for grouped episode entries). */
  rows: { id: string; watched_at: string }[];
};

/** One watch row as read for the diary, from either table. */
export type DiaryWatch = {
  kind: 'movie' | 'episode';
  id: string;
  watched_at: string;
  title: {
    title: string;
    poster_path: string | null;
    tmdb_id: number;
    media_type: 'movie' | 'tv';
  } | null;
  episode?: { name: string | null; season_number: number; episode_number: number } | null;
};

/**
 * Where the next page starts: strictly after this (watched_at, id). The id is
 * what makes it total — logging a whole season writes many rows with the same
 * timestamp, and a timestamp-only cursor skips all but one of them.
 */
export type DiaryCursor = { watched_at: string; id: string };

export type DiaryPage = { rows: DiaryWatch[]; nextCursor: DiaryCursor | null };

/**
 * Order by (watched_at, id), the order Postgres uses. Plain string comparison,
 * not `localeCompare`: collation may skip the `+`/`.` punctuation that sorts
 * PostgREST's UTC timestamps correctly, and uuids compare bytewise.
 */
function compareWatch(a: DiaryCursor, b: DiaryCursor): number {
  if (a.watched_at !== b.watched_at) return a.watched_at < b.watched_at ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

const newestFirst = (a: DiaryCursor, b: DiaryCursor) => compareWatch(b, a);

/**
 * Merge one page read from each table (each newest first, at most `size`
 * rows). A table that returned a full page may have more rows just below its
 * last one, so everything older than the newest such tail is not known to be
 * complete: it is dropped here and read again from the next cursor.
 */
export function mergeDiaryPage(
  movies: DiaryWatch[],
  episodes: DiaryWatch[],
  size: number,
): DiaryPage {
  const all = [...movies, ...episodes].sort(newestFirst);
  const tails = [movies, episodes]
    .filter((rows) => rows.length >= size)
    .map((rows) => rows[rows.length - 1]);
  if (tails.length === 0) return { rows: all, nextCursor: null };

  const boundary = tails.reduce((a, b) => (compareWatch(a, b) >= 0 ? a : b));
  return {
    rows: all.filter((r) => compareWatch(r, boundary) >= 0),
    nextCursor: { watched_at: boundary.watched_at, id: boundary.id },
  };
}

/** The device's calendar day of an instant, as YYYY-MM-DD. */
function localDayKey(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Watches → diary entries, newest first. Episodes group by show + season +
 * local calendar day, so logging a whole season collapses to one entry
 * ("Season 8 · 6 episodes"). The day is the device's, the same one the row
 * displays — not the UTC date in the timestamp.
 */
export function groupDiary(watches: DiaryWatch[]): DiaryEntry[] {
  const movieEntries: DiaryEntry[] = [];
  const episodeGroups = new Map<string, DiaryWatch[]>();

  for (const r of watches) {
    if (r.kind === 'movie') {
      movieEntries.push({
        id: `m_${r.id}`,
        kind: 'movie',
        watched_at: r.watched_at,
        titleName: r.title?.title ?? 'Unknown',
        posterPath: r.title?.poster_path ?? null,
        subtitle: 'Movie',
        tmdbId: r.title?.tmdb_id as number,
        mediaType: r.title?.media_type ?? 'movie',
        rows: [{ id: r.id, watched_at: r.watched_at }],
      });
      continue;
    }
    const season = r.episode?.season_number ?? 'na';
    const key = `${r.title?.tmdb_id}_${season}_${localDayKey(r.watched_at)}`;
    const bucket = episodeGroups.get(key);
    if (bucket) bucket.push(r);
    else episodeGroups.set(key, [r]);
  }

  const episodeEntries: DiaryEntry[] = [...episodeGroups.values()].map((group) => {
    group.sort(newestFirst);
    const r = group[0]; // most recent in the group
    const ep = r.episode;
    const count = group.length;
    const subtitle =
      count > 1
        ? ep
          ? `Season ${ep.season_number} · ${count} episodes`
          : `${count} episodes`
        : ep
          ? `S${ep.season_number}E${ep.episode_number}` +
            (ep.name ? ` · ${ep.name}` : '')
          : null;
    return {
      id: `e_${r.id}`,
      kind: 'episode',
      watched_at: r.watched_at,
      titleName: r.title?.title ?? 'Unknown',
      posterPath: r.title?.poster_path ?? null,
      subtitle,
      tmdbId: r.title?.tmdb_id as number,
      mediaType: r.title?.media_type ?? 'tv',
      rows: group.map((g) => ({ id: g.id, watched_at: g.watched_at })),
    };
  });

  return [...movieEntries, ...episodeEntries].sort((a, b) =>
    compareWatch(
      { watched_at: b.watched_at, id: b.rows[0].id },
      { watched_at: a.watched_at, id: a.rows[0].id },
    ),
  );
}
