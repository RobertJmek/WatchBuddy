import { supabase } from '@/lib/supabase';

export type Genre = { id: number; name: string };

/**
 * The genre catalog (TMDB ids → names). World-readable, ~19 rows that never
 * change, so callers fetch it under `['genres']` with `staleTime: Infinity` —
 * the AsyncStorage persister in `query.ts` then makes it free after the first
 * run. Titles carry bare `genre_id`s (see `getLibrary`); this is how they get
 * a label.
 */
export async function getGenres(): Promise<Genre[]> {
  const { data, error } = await supabase
    .from('genres')
    .select('id, name')
    .order('name');
  if (error) throw error;
  return (data ?? []) as Genre[];
}
