import { supabase } from '@/lib/supabase';
import { currentViewer, requireViewer } from '@/lib/viewer';

/** One reply in a review thread, flattened for the two-level render. */
export type ReplyItem = {
  id: string;
  userId: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  body: string;
  created_at: string;
  parentReplyId: string | null;
  /** Visual level: 0 = direct reply to the review, 1 = reply to a reply. */
  level: 0 | 1;
  /** Username of the reply being answered (level 1 only) — the @mention. */
  replyToUsername: string | null;
  isMine: boolean;
  isDeleted: boolean;
};

export type ReviewThread = {
  review: {
    ratingId: string;
    userId: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    value: number;
    review: string;
    updated_at: string;
    /** Likes received on the written review. */
    likeCount: number;
    /** Whether the viewer has liked it (always false on your own review). */
    likedByMe: boolean;
    /** The review is the viewer's own — no self-like, display-only counter. */
    isMine: boolean;
  };
  replies: ReplyItem[];
};

/**
 * A review plus its full reply thread. The tree is stored with arbitrary
 * nesting but rendered as two levels: every descendant of a top-level reply
 * flattens under it (chronologically) with an @mention of its direct parent.
 */
export async function getReviewThread(ratingId: string): Promise<ReviewThread> {
  const viewerId = await currentViewer();

  const [ratingRes, repliesRes, likeCountRes, myLikeRes] = await Promise.all([
    supabase
      .from('ratings')
      .select('id, user_id, value, review, updated_at')
      .eq('id', ratingId)
      .single(),
    supabase
      .from('review_replies')
      .select('id, user_id, body, created_at, parent_reply_id, deleted_at')
      .eq('rating_id', ratingId)
      .order('created_at'),
    // Just the total — the likers list is fetched separately on the likes screen.
    supabase
      .from('review_likes')
      .select('rating_id', { count: 'exact', head: true })
      .eq('rating_id', ratingId),
    // Viewer-scoped existence (0/1); skipped when signed out.
    viewerId
      ? supabase
          .from('review_likes')
          .select('rating_id', { count: 'exact', head: true })
          .eq('rating_id', ratingId)
          .eq('user_id', viewerId)
      : Promise.resolve({ count: 0, error: null }),
  ]);
  if (ratingRes.error) throw ratingRes.error;
  if (repliesRes.error) throw repliesRes.error;
  if (likeCountRes.error) throw likeCountRes.error;
  const rating = ratingRes.data as any;
  const rows = (repliesRes.data ?? []) as any[];
  const likeCount = likeCountRes.count ?? 0;
  const myLikeCount = myLikeRes.count ?? 0;

  const userIds = [...new Set([rating.user_id, ...rows.map((r) => r.user_id)])];
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', userIds);
  if (profErr) throw profErr;
  const profileById = new Map<string, any>((profiles ?? []).map((p) => [p.id, p]));

  const rowById = new Map<string, any>(rows.map((r) => [r.id, r]));
  // Walk up to the top-level ancestor (parents may be tombstoned or, after an
  // account-deletion cascade, missing — then the row is treated as top-level).
  function rootOf(row: any): any {
    let cur = row;
    while (cur.parent_reply_id && rowById.has(cur.parent_reply_id)) {
      cur = rowById.get(cur.parent_reply_id);
    }
    return cur;
  }

  const decorated = rows.map((r) => {
    const p = profileById.get(r.user_id);
    const isChild = !!(r.parent_reply_id && rowById.has(r.parent_reply_id));
    const parent = isChild ? rowById.get(r.parent_reply_id) : null;
    const parentProfile = parent ? profileById.get(parent.user_id) : null;
    return {
      id: r.id,
      userId: r.user_id,
      username: p?.username ?? null,
      display_name: p?.display_name ?? null,
      avatar_url: p?.avatar_url ?? null,
      body: r.deleted_at ? '' : r.body,
      created_at: r.created_at,
      parentReplyId: r.parent_reply_id ?? null,
      level: (isChild ? 1 : 0) as 0 | 1,
      replyToUsername: isChild ? (parentProfile?.username ?? null) : null,
      isMine: r.user_id === viewerId,
      isDeleted: !!r.deleted_at,
      rootId: rootOf(r).id as string,
    };
  });

  // Top-level replies chronological; each one followed by its flattened
  // descendants, also chronological.
  const replies: ReplyItem[] = [];
  for (const top of decorated.filter((d) => d.level === 0)) {
    replies.push(top);
    replies.push(
      ...decorated.filter((d) => d.level === 1 && d.rootId === top.id),
    );
  }

  const rp = profileById.get(rating.user_id);
  const isMine = rating.user_id === viewerId;
  return {
    review: {
      ratingId: rating.id,
      userId: rating.user_id,
      username: rp?.username ?? null,
      display_name: rp?.display_name ?? null,
      avatar_url: rp?.avatar_url ?? null,
      value: rating.value,
      review: (rating.review ?? '').trim(),
      updated_at: rating.updated_at,
      likeCount,
      // Never mark your own review as liked (self-likes don't exist / RLS-blocked).
      likedByMe: !isMine && myLikeCount > 0,
      isMine,
    },
    replies,
  };
}

export async function addReply(
  ratingId: string,
  body: string,
  parentReplyId?: string,
) {
  const uid = await requireViewer();
  const { error } = await supabase.from('review_replies').insert({
    rating_id: ratingId,
    user_id: uid,
    body: body.trim(),
    parent_reply_id: parentReplyId ?? null,
  });
  if (error) throw error;
}

/** Tombstone the reply: the row survives so child replies keep context. */
export async function deleteReply(id: string) {
  const uid = await requireViewer();
  const { error } = await supabase
    .from('review_replies')
    .update({ deleted_at: new Date().toISOString(), body: '' })
    .eq('id', id)
    .eq('user_id', uid);
  if (error) throw error;
}
