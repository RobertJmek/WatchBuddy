import { supabase } from '@/lib/supabase';
import { currentViewer, requireViewer, selectMine } from '@/lib/viewer';

export type RatingEntityType = 'movie' | 'show';

export function entityTypeFor(mediaType: 'movie' | 'tv'): RatingEntityType {
  return mediaType === 'tv' ? 'show' : 'movie';
}

export type Rating = {
  id: string;
  value: number;
  review: string | null;
  /** Likes received on the written review (0 when none / no text). */
  likeCount: number;
};

export async function getRating(
  entityType: RatingEntityType,
  entityId: string,
): Promise<Rating | null> {
  const { q } = await selectMine('ratings', 'id, value, review');
  const { data, error } = await q
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { count } = await supabase
    .from('review_likes')
    .select('rating_id', { count: 'exact', head: true })
    .eq('rating_id', data.id);
  return {
    id: data.id,
    value: data.value,
    review: data.review,
    likeCount: count ?? 0,
  };
}

export async function setRating(
  entityType: RatingEntityType,
  entityId: string,
  value: number,
  review: string | null,
) {
  const uid = await requireViewer();
  const { error } = await supabase.from('ratings').upsert(
    {
      user_id: uid,
      entity_type: entityType,
      entity_id: entityId,
      value,
      review: review && review.trim() ? review.trim() : null,
    },
    { onConflict: 'user_id,entity_type,entity_id' },
  );
  if (error) throw error;
}

/** One user's written review of a title, for the community list. */
export type ReviewItem = {
  ratingId: string;
  userId: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_following: boolean;
  /** The viewer's own review — shown with a "You" badge, heart display-only. */
  isMine: boolean;
  value: number;
  review: string;
  updated_at: string;
  likeCount: number;
  likedByMe: boolean;
  replyCount: number;
};

export type ReviewSort = 'top' | 'recent' | 'highest' | 'lowest';

/**
 * Sort a review list. 'top' pins followed users first (then likes, then
 * newest); every other sort is pure — no followed-first pinning.
 */
export function sortReviews(reviews: ReviewItem[], sort: ReviewSort) {
  const byRecent = (a: ReviewItem, b: ReviewItem) =>
    b.updated_at.localeCompare(a.updated_at);
  const byLikes = (a: ReviewItem, b: ReviewItem) =>
    b.likeCount - a.likeCount || byRecent(a, b);
  const sorted = [...reviews];
  switch (sort) {
    case 'top':
      sorted.sort((a, b) => {
        if (a.is_following !== b.is_following) return a.is_following ? -1 : 1;
        return byLikes(a, b);
      });
      break;
    case 'recent':
      sorted.sort(byRecent);
      break;
    case 'highest':
      sorted.sort((a, b) => b.value - a.value || byLikes(a, b));
      break;
    case 'lowest':
      sorted.sort((a, b) => a.value - b.value || byLikes(a, b));
      break;
  }
  return sorted;
}

export type TitleRatings = {
  /** Mean of every user's score (0 when there are no ratings). */
  average: number;
  /** How many users have rated (with or without a written review). */
  count: number;
  /** Written reviews only (the viewer's own included), in Top order. */
  reviews: ReviewItem[];
};

/**
 * The community rating for a title: average + count over all scores, plus the
 * written reviews joined to their authors. Composed client-side (ratings ->
 * profiles -> follows) since reads are world-open.
 */
export async function getTitleRatings(
  entityType: RatingEntityType,
  entityId: string,
): Promise<TitleRatings> {
  const viewerId = await currentViewer();

  const { data, error } = await supabase
    .from('ratings')
    .select('id, user_id, value, review, updated_at')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId);
  if (error) throw error;
  const rows = (data ?? []) as any[];

  const count = rows.length;
  const average =
    count > 0 ? rows.reduce((sum, r) => sum + (r.value ?? 0), 0) / count : 0;

  // Every written review, the viewer's own included (marked isMine below).
  const textRows = rows.filter((r) => r.review && r.review.trim());
  if (textRows.length === 0) return { average, count, reviews: [] };

  const ids: string[] = textRows.map((r) => r.user_id);
  const ratingIds: string[] = textRows.map((r) => r.id);

  const [profilesRes, followsRes, likesRes, repliesRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', ids),
    viewerId
      ? supabase
          .from('follows')
          .select('followee_id')
          .eq('follower_id', viewerId)
          .in('followee_id', ids)
      : Promise.resolve({ data: [], error: null } as any),
    supabase
      .from('review_likes')
      .select('rating_id, user_id')
      .in('rating_id', ratingIds),
    supabase
      .from('review_replies')
      .select('rating_id')
      .is('deleted_at', null)
      .in('rating_id', ratingIds),
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

  const profiles = new Map<string, any>(
    (profilesRes.data ?? []).map((p: any) => [p.id, p]),
  );
  const following = new Set(
    (followsRes.data ?? []).map((f: any) => f.followee_id),
  );

  const reviews: ReviewItem[] = textRows.map((r) => {
    const p = profiles.get(r.user_id);
    return {
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
    };
  });

  return { average, count, reviews: sortReviews(reviews, 'top') };
}

export async function likeReview(ratingId: string) {
  const uid = await requireViewer();
  const { error } = await supabase
    .from('review_likes')
    .insert({ rating_id: ratingId, user_id: uid });
  // Double-tap races just mean the like already exists — not an error.
  if (error && !error.message.includes('duplicate')) throw error;
}

export async function unlikeReview(ratingId: string) {
  const uid = await requireViewer();
  const { error } = await supabase
    .from('review_likes')
    .delete()
    .eq('rating_id', ratingId)
    .eq('user_id', uid);
  if (error) throw error;
}

export async function removeRating(
  entityType: RatingEntityType,
  entityId: string,
) {
  const { error } = await supabase
    .from('ratings')
    .delete()
    .eq('entity_type', entityType)
    .eq('entity_id', entityId);
  if (error) throw error;
}
