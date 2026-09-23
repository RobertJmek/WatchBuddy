// Library writes for the TV Time importer, through the viewer seam: TV Time
// timestamps, and "existing library rows win" (unlike logMovieWatch, which
// force-promotes the status). The watch inserts live in ../import-core.

import { supabase } from '@/lib/supabase';
import type { LibraryStatus } from '@/lib/library';
import { requireViewer, selectAllMine } from '@/lib/viewer';

/** TV Time's "YYYY-MM-DD HH:MM:SS" (UTC) → ISO timestamp for Postgres. */
export function toIsoTimestamp(tvTime: string): string {
  const d = new Date(tvTime.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export type LibraryState = Map<string, { status: LibraryStatus; is_favorite: boolean }>;

export async function prefetchLibrary(): Promise<LibraryState> {
  const rows = await selectAllMine<{
    title_id: string;
    status: LibraryStatus;
    is_favorite: boolean;
  }>('library_items', 'title_id, status, is_favorite');
  return new Map(rows.map((r) => [r.title_id, r]));
}

/**
 * Insert a library row with the inferred status — but never touch an existing
 * one. `state` is the prefetched library map; it's updated in place so later
 * phases see the row.
 */
export async function setLibraryStatusIfAbsent(
  state: LibraryState,
  titleId: string,
  status: LibraryStatus,
): Promise<void> {
  if (state.has(titleId)) return;
  const uid = await requireViewer();
  const { error } = await supabase.from('library_items').upsert(
    { user_id: uid, title_id: titleId, status },
    { onConflict: 'user_id,title_id', ignoreDuplicates: true },
  );
  if (error) throw error;
  state.set(titleId, { status, is_favorite: false });
}
