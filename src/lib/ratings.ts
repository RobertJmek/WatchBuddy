import { supabase } from '@/lib/supabase';
import { currentViewer, requireViewer, selectMine } from '@/lib/viewer';

export type RatingEntityType = 'movie' | 'show';

export function entityTypeFor(mediaType: 'movie' | 'tv'): RatingEntityType {
  return mediaType === 'tv' ? 'show' : 'movie';
}

export type Rating = { value: number; review: string | null };

export async function getRating(
  entityType: RatingEntityType,
  entityId: string,
): Promise<Rating | null> {
  const { q } = await selectMine('ratings', 'value, review');
  const { data, error } = await q
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();
  if (error) throw error;
  return data ? { value: data.value, review: data.review } : null;
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
  userId: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_following: boolean;
  value: number;
  review: string;
  updated_at: string;
};

export type TitleRatings = {
  /** Mean of every user's score (0 when there are no ratings). */
  average: number;
  /** How many users have rated (with or without a written review). */
  count: number;
  /** Written reviews only, excluding the viewer, sorted followed-first then newest. */
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
    .select('user_id, value, review, updated_at')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId);
  if (error) throw error;
  const rows = (data ?? []) as any[];

  const count = rows.length;
  const average =
    count > 0 ? rows.reduce((sum, r) => sum + (r.value ?? 0), 0) / count : 0;

  // Written reviews by other users.
  const textRows = rows.filter(
    (r) => r.review && r.review.trim() && r.user_id !== viewerId,
  );
  if (textRows.length === 0) return { average, count, reviews: [] };

  const ids: string[] = textRows.map((r) => r.user_id);

  const [profilesRes, followsRes] = await Promise.all([
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
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (followsRes.error) throw followsRes.error;

  const profiles = new Map<string, any>(
    (profilesRes.data ?? []).map((p: any) => [p.id, p]),
  );
  const following = new Set(
    (followsRes.data ?? []).map((f: any) => f.followee_id),
  );

  const reviews: ReviewItem[] = textRows.map((r) => {
    const p = profiles.get(r.user_id);
    return {
      userId: r.user_id,
      username: p?.username ?? null,
      display_name: p?.display_name ?? null,
      avatar_url: p?.avatar_url ?? null,
      is_following: following.has(r.user_id),
      value: r.value,
      review: r.review.trim(),
      updated_at: r.updated_at,
    };
  });

  // Followed users first, then most recent.
  reviews.sort((a, b) => {
    if (a.is_following !== b.is_following) return a.is_following ? -1 : 1;
    return b.updated_at.localeCompare(a.updated_at);
  });

  return { average, count, reviews };
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
