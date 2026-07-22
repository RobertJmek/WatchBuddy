import { type ReviewItem } from '@/lib/ratings';
import { supabase } from '@/lib/supabase';
import { currentViewer, requireViewer } from '@/lib/viewer';

/** A person as shown in a feed row (actor or follow target). */
export type FeedActor = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type FeedBase = { key: string; createdAt: string; actor: FeedActor };

/**
 * One entry in the following activity feed. Discriminated on `type`. Review
 * events carry a full `ReviewItem` so the row can reuse `ReviewRow` (inline
 * like + tap-through to the thread); every other event is a compact row.
 */
/** Enough to navigate to and label a title (`/title/[id]` takes the TMDB id). */
export type FeedTitle = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  name: string;
};

export type FeedItem =
  | (FeedBase & { type: 'episode_watch'; title: FeedTitle; count: number })
  | (FeedBase & { type: 'movie_watch'; title: FeedTitle })
  | (FeedBase & { type: 'rating'; title: FeedTitle; value: number; ratingId: string })
  | (FeedBase & { type: 'review'; review: ReviewItem; title: FeedTitle | null })
  | (FeedBase & { type: 'follow'; target: FeedActor })
  | (FeedBase & { type: 'like'; ratingId: string; titleName: string | null })
  | (FeedBase & { type: 'reply'; ratingId: string; titleName: string | null });

export type FeedPage = { items: FeedItem[]; nextCursor: string | null };

/** The raw shape returned by the get_feed RPC (one row per event). */
type FeedRow = {
  type: FeedItem['type'];
  actor_id: string;
  entity_id: string | null;
  target_user_id: string | null;
  rating_id: string | null;
  count: number;
  value: number | null;
  created_at: string;
};

const DEFAULT_LIMIT = 30;

/**
 * The viewer's following feed, newest first, keyset-paged on `created_at`.
 * The RPC returns lean event rows; author/title/review context is hydrated
 * client-side in batched `.in()` lookups (same pattern as `getNotifications`).
 */
export async function getFeed({
  before,
  limit = DEFAULT_LIMIT,
}: { before?: string; limit?: number } = {}): Promise<FeedPage> {
  const viewerId = await currentViewer();

  const { data, error } = await supabase.rpc('get_feed', {
    p_limit: limit,
    p_before: before ?? null,
  });
  if (error) throw error;
  const rows = (data ?? []) as FeedRow[];
  if (rows.length === 0) return { items: [], nextCursor: null };

  const actorIds = new Set<string>();
  const titleIds = new Set<string>();
  const reviewRatingIds: string[] = [];
  for (const r of rows) {
    actorIds.add(r.actor_id);
    if (r.target_user_id) actorIds.add(r.target_user_id);
    if (r.entity_id) titleIds.add(r.entity_id);
    if (r.type === 'review' && r.rating_id) reviewRatingIds.push(r.rating_id);
  }

  const [profilesRes, titlesRes, reviewById] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', [...actorIds]),
    titleIds.size
      ? supabase
          .from('titles')
          .select('id, tmdb_id, media_type, title')
          .in('id', [...titleIds])
      : Promise.resolve({ data: [], error: null } as any),
    hydrateReviews(reviewRatingIds, viewerId),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (titlesRes.error) throw titlesRes.error;

  const profileById = new Map<string, any>(
    (profilesRes.data ?? []).map((p: any) => [p.id, p]),
  );
  const titleById = new Map<string, FeedTitle>(
    (titlesRes.data ?? []).map((t: any) => [
      t.id,
      { tmdbId: t.tmdb_id, mediaType: t.media_type, name: t.title },
    ]),
  );

  const actorOf = (id: string): FeedActor => {
    const p = profileById.get(id);
    return {
      id,
      username: p?.username ?? null,
      display_name: p?.display_name ?? null,
      avatar_url: p?.avatar_url ?? null,
    };
  };

  const items: FeedItem[] = [];
  for (const r of rows) {
    const base = {
      // No natural row id from a UNION — synthesise a stable key.
      key: `${r.type}:${r.actor_id}:${r.rating_id ?? r.entity_id ?? r.target_user_id}:${r.created_at}`,
      createdAt: r.created_at,
      actor: actorOf(r.actor_id),
    };
    const title = r.entity_id ? (titleById.get(r.entity_id) ?? null) : null;

    switch (r.type) {
      case 'episode_watch':
        if (!title) break;
        items.push({ ...base, type: 'episode_watch', title, count: r.count });
        break;
      case 'movie_watch':
        if (!title) break;
        items.push({ ...base, type: 'movie_watch', title });
        break;
      case 'rating':
        if (!title || r.value == null || !r.rating_id) break;
        items.push({ ...base, type: 'rating', title, value: r.value, ratingId: r.rating_id });
        break;
      case 'review': {
        // Skip if the review text vanished between the RPC and hydration.
        const review = r.rating_id ? reviewById.get(r.rating_id) : undefined;
        if (!review) break;
        items.push({ ...base, type: 'review', review, title });
        break;
      }
      case 'follow':
        if (!r.target_user_id) break;
        items.push({ ...base, type: 'follow', target: actorOf(r.target_user_id) });
        break;
      case 'like':
        if (!r.rating_id) break;
        items.push({ ...base, type: 'like', ratingId: r.rating_id, titleName: title?.name ?? null });
        break;
      case 'reply':
        if (!r.rating_id) break;
        items.push({ ...base, type: 'reply', ratingId: r.rating_id, titleName: title?.name ?? null });
        break;
    }
  }

  // A full page implies there may be more; cursor is the oldest row we fetched.
  const nextCursor =
    rows.length >= limit ? rows[rows.length - 1].created_at : null;
  return { items, nextCursor };
}

/**
 * Advance the viewer's feed "seen" watermark to now. Called when leaving the
 * Feed screen so friends'-activity the viewer just looked at is marked seen —
 * it lingers ~24h more (see get_feed) then drops off. Advancing on blur (not
 * focus) keeps the list stable while the viewer is reading it.
 */
export async function markFeedSeen() {
  const uid = await requireViewer();
  const { error } = await supabase
    .from('profiles')
    .update({ feed_seen_at: new Date().toISOString() })
    .eq('id', uid);
  if (error) throw error;
}

/**
 * Build `ReviewItem`s for a set of rating ids (author, follow state, likes,
 * replies) — the same composition `getTitleRatings` does, keyed by rating id
 * so feed review rows get the exact shape `ReviewRow` expects.
 */
async function hydrateReviews(
  ratingIds: string[],
  viewerId: string | null,
): Promise<Map<string, ReviewItem>> {
  const out = new Map<string, ReviewItem>();
  if (ratingIds.length === 0) return out;

  const { data: ratingRows, error: ratingsErr } = await supabase
    .from('ratings')
    .select('id, user_id, value, review, updated_at')
    .in('id', ratingIds);
  if (ratingsErr) throw ratingsErr;
  const rows = ((ratingRows ?? []) as any[]).filter(
    (r) => r.review && r.review.trim(),
  );
  if (rows.length === 0) return out;

  const authorIds = [...new Set(rows.map((r) => r.user_id))];
  const ids = rows.map((r) => r.id);

  const [profilesRes, followsRes, likesRes, repliesRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', authorIds),
    viewerId
      ? supabase
          .from('follows')
          .select('followee_id')
          .eq('follower_id', viewerId)
          .in('followee_id', authorIds)
      : Promise.resolve({ data: [], error: null } as any),
    supabase.from('review_likes').select('rating_id, user_id').in('rating_id', ids),
    supabase
      .from('review_replies')
      .select('rating_id')
      .is('deleted_at', null)
      .in('rating_id', ids),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (followsRes.error) throw followsRes.error;
  if (likesRes.error) throw likesRes.error;
  if (repliesRes.error) throw repliesRes.error;

  const replyCounts = new Map<string, number>();
  for (const r of (repliesRes.data ?? []) as any[]) {
    replyCounts.set(r.rating_id, (replyCounts.get(r.rating_id) ?? 0) + 1);
  }
  const likeCounts = new Map<string, number>();
  const likedByMe = new Set<string>();
  for (const l of (likesRes.data ?? []) as any[]) {
    likeCounts.set(l.rating_id, (likeCounts.get(l.rating_id) ?? 0) + 1);
    if (l.user_id === viewerId) likedByMe.add(l.rating_id);
  }
  const profileById = new Map<string, any>(
    (profilesRes.data ?? []).map((p: any) => [p.id, p]),
  );
  const following = new Set(
    (followsRes.data ?? []).map((f: any) => f.followee_id),
  );

  for (const r of rows) {
    const p = profileById.get(r.user_id);
    out.set(r.id, {
      ratingId: r.id,
      userId: r.user_id,
      username: p?.username ?? null,
      display_name: p?.display_name ?? null,
      avatar_url: p?.avatar_url ?? null,
      is_following: following.has(r.user_id),
      isMine: r.user_id === viewerId,
      value: r.value,
      review: r.review.trim(),
      updated_at: r.updated_at,
      likeCount: likeCounts.get(r.id) ?? 0,
      likedByMe: likedByMe.has(r.id),
      replyCount: replyCounts.get(r.id) ?? 0,
    });
  }
  return out;
}
