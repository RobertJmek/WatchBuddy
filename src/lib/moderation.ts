import type { QueryClient } from '@tanstack/react-query';

import { keys } from '@/lib/keys';
import { parseIdList } from '@/lib/rpc-shape';
import type { UserResult } from '@/lib/social';
import { supabase } from '@/lib/supabase';
import { deleteMine, requireViewer, selectMine } from '@/lib/viewer';

/**
 * Block and report — see ADR 0025.
 *
 * A block is MUTUAL and enforced by the database: once it exists, the read
 * policies hide each side's reviews, replies, likes, watches, library and follow
 * edges from the other, and the write policies refuse a follow, reply or like
 * between them. Nothing in the client filters those lists, so this module only
 * has to create and lift blocks and to answer "who is hidden from me".
 *
 * `profiles` stays readable on purpose (older builds hydrate names from it), so
 * the two places that list profiles directly — user search and the profile
 * screen — are handled here and in their own code.
 */

export type ReportTarget = 'review' | 'reply' | 'user';

/** The reasons offered, in menu order. `value` is what the `reports` table stores. */
export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'spoilers', label: 'Spoilers' },
  { value: 'other', label: 'Other' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['value'];

/**
 * Block a user. One RPC rather than an insert: `block_user` also removes the
 * follows between the two, in both directions, in the same transaction. There is
 * no insert grant on `blocks`, so this is the only way in.
 */
export async function blockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('block_user', { p_target: userId });
  if (error) throw error;
}

/**
 * Lift a block. Deliberately does not restore the follows it removed: a block
 * ends the relationship, and lifting it does not decide that two people follow
 * each other again.
 */
export async function unblockUser(userId: string): Promise<void> {
  const { q } = await deleteMine('blocks', 'blocker_id');
  const { error } = await q.eq('blocked_id', userId);
  if (error) throw error;
}

/**
 * Everyone hidden from the viewer: the people they blocked AND the people who
 * blocked them. The second half is what the blocker's own list cannot show, and
 * it is what turns "no data" into "this profile isn't available".
 */
export async function getHiddenUserIds(): Promise<string[]> {
  const { data, error } = await supabase.rpc('hidden_user_ids');
  if (error) throw error;
  return parseIdList(data, 'hidden_user_ids');
}

/** The people the viewer has blocked, most recent first, shaped like any user row. */
export async function getBlockedUsers(): Promise<UserResult[]> {
  const { q } = await selectMine('blocks', 'blocked_id, created_at', 'blocker_id');
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  const ids = (data ?? []).map((r: { blocked_id: string }) => r.blocked_id);
  if (ids.length === 0) return [];

  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', ids);
  if (profErr) throw profErr;
  const byId = new Map<string, any>((profiles ?? []).map((p: any) => [p.id, p]));

  // Keep the block order. A profile that is gone (account deleted) drops out — a
  // block row for it would cascade away too, so this only covers the race.
  return ids.flatMap((id: string) => {
    const p = byId.get(id);
    return p
      ? [
          {
            id,
            username: p.username ?? null,
            display_name: p.display_name ?? null,
            avatar_url: p.avatar_url ?? null,
            is_following: false,
          },
        ]
      : [];
  });
}

/**
 * How the viewer stands with another user:
 *  - `blocked`     — you blocked them (you may lift it);
 *  - `unavailable` — hidden from you but not by you: they blocked you. Nothing
 *                    more is said, on purpose;
 *  - `none`        — no block either way.
 */
export type BlockStatus = 'none' | 'blocked' | 'unavailable';

export async function getBlockStatus(userId: string): Promise<BlockStatus> {
  const { q } = await selectMine('blocks', 'blocked_id', 'blocker_id');
  const [mine, hidden] = await Promise.all([
    q.eq('blocked_id', userId).maybeSingle(),
    getHiddenUserIds(),
  ]);
  if (mine.error) throw mine.error;
  if (mine.data) return 'blocked';
  return hidden.includes(userId) ? 'unavailable' : 'none';
}

/**
 * File a report. The `reports` table is insert-only for the client — no select
 * grant — so this must not chain `.select()`, which would ask for a RETURNING
 * the role may not read.
 *
 * Reporting the same thing twice is one report: the unique violation is treated
 * as success, the way `follow()` treats a duplicate edge. For a review or a
 * reply the item stops being visible to the reporter as soon as the row lands.
 */
export async function reportContent(
  target: ReportTarget,
  targetId: string,
  reason: ReportReason,
  note?: string,
): Promise<void> {
  const uid = await requireViewer();
  const { error } = await supabase.from('reports').insert({
    reporter_id: uid,
    target_type: target,
    target_id: targetId,
    reason,
    note: note?.trim() || null,
  });
  if (error && error.code !== '23505') throw error;
}

/**
 * After a block is created or lifted, drop every cached read a block can change.
 * The roots are the ones `keys.ts` already names, so a bare key reaches every
 * user's copy by prefix. Cached pages are persisted for a week, so leaving one
 * alone would keep showing somebody's reviews long after the server stopped
 * sending them.
 */
export function invalidateBlockScoped(queryClient: QueryClient) {
  for (const queryKey of [
    keys.blocked(),
    keys.feed(),
    keys.titleRatings(),
    keys.reviewThread(),
    keys.reviewLikers(),
    keys.notifications(),
    keys.notifUnread(),
    keys.follow(),
    keys.followers(),
    keys.following(),
    keys.followCounts(),
    keys.stats(),
    keys.library(),
    keys.diary(),
    keys.userSearch(),
  ]) {
    queryClient.invalidateQueries({ queryKey });
  }
}

/** After reporting a review or reply: the places it was showing. */
export function invalidateAfterReport(queryClient: QueryClient) {
  for (const queryKey of [
    keys.feed(),
    keys.titleRatings(),
    keys.reviewThread(),
    keys.notifications(),
  ]) {
    queryClient.invalidateQueries({ queryKey });
  }
}
