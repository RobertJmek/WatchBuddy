import { supabase } from '@/lib/supabase';

/**
 * The Viewer seam: the one place that answers "who is the signed-in user" and
 * "scope this read to them". Every data module goes through here instead of
 * touching `supabase.auth` or hand-typing `.eq('user_id', …)` — so identity has
 * a single home and personal reads can't accidentally leak other users' rows
 * under the open-read RLS policy.
 */

/** The signed-in user's id. Throws when there is no session. */
export async function requireViewer(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  return user.id;
}

/** The signed-in user's id, or null — for world-open reads that work signed-out. */
export async function currentViewer(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * A SELECT already scoped to the signed-in viewer: the `user_id` filter is
 * applied for you. Chain further filters/order/limit on the result. Using this
 * for personal reads makes the "returns every user's rows" leak impossible to
 * write by omission.
 */
export async function selectMine(table: string, columns = '*') {
  const uid = await requireViewer();
  // The client is untyped (no generated Database type), so a dynamic table name
  // resolves to the error overload — cast to the chainable builder once, here,
  // so every call site stays clean.
  return (supabase.from(table) as any).select(columns).eq('user_id', uid);
}
