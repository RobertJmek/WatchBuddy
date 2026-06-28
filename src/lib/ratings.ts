import { supabase } from '@/lib/supabase';

export type RatingEntityType = 'movie' | 'show';

export function entityTypeFor(mediaType: 'movie' | 'tv'): RatingEntityType {
  return mediaType === 'tv' ? 'show' : 'movie';
}

export type Rating = { value: number; review: string | null };

export async function getRating(
  entityType: RatingEntityType,
  entityId: string,
): Promise<Rating | null> {
  const { data, error } = await supabase
    .from('ratings')
    .select('value, review')
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('ratings').upsert(
    {
      user_id: user.id,
      entity_type: entityType,
      entity_id: entityId,
      value,
      review: review && review.trim() ? review.trim() : null,
    },
    { onConflict: 'user_id,entity_type,entity_id' },
  );
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
