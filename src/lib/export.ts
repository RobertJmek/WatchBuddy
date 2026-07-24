// "Download your data": gather everything WatchBuddy stores about the signed-in
// user into one JSON document, through the viewer seam. Shared catalog rows
// (titles/episodes) are included only as lookup tables for the ids the user's
// rows reference, so the export is self-describing.

import { supabase } from '@/lib/supabase';
import { requireViewer, selectMine } from '@/lib/viewer';

const PAGE = 1000;

// makeQuery resolves to `{ q: builder }` — the same wrapper trick as
// selectMine. Resolving to a bare builder would let `await` collapse
// (execute) it and hand back `{ data, error }` instead of the chainable.
async function allPages<T>(
  makeQuery: () => Promise<{ q: any }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    const { q } = await makeQuery();
    const { data, error } = await q.range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows;
}

const allMine = <T>(table: string, columns: string) =>
  allPages<T>(() => selectMine(table, columns));

/** Every row the user owns, plus lookups for the catalog ids they reference. */
export async function buildExport(): Promise<Record<string, unknown>> {
  const uid = await requireViewer();

  const [
    profile,
    libraryItems,
    episodeWatches,
    movieWatches,
    ratings,
    reviewLikes,
    reviewReplies,
    notifications,
    following,
    followers,
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
    allMine<any>('library_items', '*'),
    allMine<any>('episode_watches', '*'),
    allMine<any>('movie_watches', '*'),
    allMine<any>('ratings', '*'),
    allMine<any>('review_likes', '*'),
    allMine<any>('review_replies', '*'),
    allMine<any>('notifications', '*'),
    allPages<any>(async () => ({
      q: supabase.from('follows').select('*').eq('follower_id', uid),
    })),
    allPages<any>(async () => ({
      q: supabase.from('follows').select('*').eq('followee_id', uid),
    })),
  ]);
  if (profile.error) throw profile.error;

  // Catalog lookups for the ids referenced above. Ratings point at titles via
  // entity_id (entity_type 'movie' | 'show').
  const titleIds = new Set<string>();
  for (const r of [...libraryItems, ...episodeWatches, ...movieWatches]) {
    if (r.title_id) titleIds.add(r.title_id);
  }
  for (const r of ratings) {
    if (r.entity_id) titleIds.add(r.entity_id);
  }
  const episodeIds = new Set<string>(
    episodeWatches.map((r: any) => r.episode_id).filter(Boolean),
  );

  const lookup = async (table: string, columns: string, ids: Set<string>) => {
    const all: any[] = [];
    const list = [...ids];
    for (let i = 0; i < list.length; i += 200) {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .in('id', list.slice(i, i + 200));
      if (error) throw error;
      all.push(...(data ?? []));
    }
    return all;
  };

  const [titles, episodes] = await Promise.all([
    lookup('titles', 'id, tmdb_id, media_type, title, release_date', titleIds),
    lookup(
      'episodes',
      'id, title_id, season_number, episode_number, name',
      episodeIds,
    ),
  ]);

  return {
    exported_at: new Date().toISOString(),
    app: 'WatchBuddy',
    // Bumped when the export shape changes; the WatchBuddy importer validates it.
    // Legacy exports predating this field are treated as v0 (same shape).
    schema_version: 1,
    user_id: uid,
    profile: profile.data,
    library_items: libraryItems,
    episode_watches: episodeWatches,
    movie_watches: movieWatches,
    ratings,
    review_likes: reviewLikes,
    review_replies: reviewReplies,
    notifications,
    follows: { following, followers },
    catalog: { titles, episodes },
  };
}
