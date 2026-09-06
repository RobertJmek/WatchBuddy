import { supabase } from '@/lib/supabase';

/**
 * The Viewer seam: the one place that answers "who is the signed-in user" and
 * "scope this read/write to them". Every data module goes through here instead
 * of touching `supabase.auth` or hand-typing `.eq('user_id', …)` — so identity
 * has a single home, personal reads can't accidentally leak other users' rows
 * under the open-read RLS policy, and a personal write can't accidentally be
 * aimed at every user's rows at once.
 */

/**
 * Concurrent identity lookups share one round-trip.
 *
 * `supabase.auth.getUser()` hits the auth server, and a batched write (see
 * `updateWatchDay`) resolves the viewer once per row — N parallel calls for
 * one user action, which is both slow and a pointless bite out of the auth rate
 * limit. The promise is cleared as soon as it settles, so nothing is ever
 * cached across an await boundary and a sign-out can't be missed.
 */
let pendingViewer: Promise<string | null> | null = null;

function lookupViewer(): Promise<string | null> {
  if (!pendingViewer) {
    pendingViewer = supabase.auth
      .getUser()
      .then(({ data }) => data.user?.id ?? null);
    // Clear on settle, success or failure, so the next call looks again.
    pendingViewer.catch(() => {}).finally(() => {
      pendingViewer = null;
    });
  }
  return pendingViewer;
}

/** The signed-in user's id. Throws when there is no session. */
export async function requireViewer(): Promise<string> {
  const uid = await lookupViewer();
  if (!uid) throw new Error('Not signed in');
  return uid;
}

/** The signed-in user's id, or null — for world-open reads that work signed-out. */
export async function currentViewer(): Promise<string | null> {
  return lookupViewer();
}

/**
 * The column that names the owner. Almost every per-user table calls it
 * `user_id`; `profiles` is the exception — its owner is its primary key `id`.
 */
export type OwnerColumn = 'user_id' | 'id';

// The client is untyped (no generated Database type), so a dynamic table name
// resolves to the error overload — cast to the chainable builder once, here,
// so every call site stays clean.
const table = (name: string) => supabase.from(name) as any;

/**
 * A SELECT already scoped to the signed-in viewer: the `user_id` filter is
 * applied for you. Returns `{ q }` — destructure it and chain further
 * filters/order/limit on `q`. Using this for personal reads makes the "returns
 * every user's rows" leak impossible to write by omission.
 *
 * The builder is returned wrapped in an object on purpose. A Supabase query
 * builder is *thenable* (awaiting it runs the query), so returning it bare from
 * this `async` function would let `await selectMine(...)` execute the query and
 * resolve to a `{ data, error }` result instead of the chainable builder —
 * breaking any caller that chains afterward. Wrapping keeps the builder intact.
 */
export async function selectMine(
  name: string,
  columns = '*',
  owner: OwnerColumn = 'user_id',
) {
  const uid = await requireViewer();
  return { q: table(name).select(columns).eq(owner, uid) };
}

/**
 * An UPDATE already scoped to the signed-in viewer. Same `{ q }` wrapping and
 * the same reason as `selectMine`.
 *
 * RLS already refuses to write another user's row, so an unscoped `.update()`
 * is not a *leak* — it is a silent no-op on rows that are not yours and a
 * correctness trap on rows that are: `.eq('title_id', …)` with no owner filter
 * describes every user's row for that title, and only the policy decides which
 * one is actually written. Saying it here makes the intent match the effect.
 */
export async function updateMine(
  name: string,
  values: Record<string, unknown>,
  owner: OwnerColumn = 'user_id',
) {
  const uid = await requireViewer();
  return { q: table(name).update(values).eq(owner, uid) };
}

/** A DELETE already scoped to the signed-in viewer. See `updateMine`. */
export async function deleteMine(name: string, owner: OwnerColumn = 'user_id') {
  const uid = await requireViewer();
  return { q: table(name).delete().eq(owner, uid) };
}
