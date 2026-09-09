import { useLocalSearchParams } from 'expo-router';

import { ReviewLikes } from '@/components/review-likes';

// "Liked by" screen for a review.
export default function ReviewLikesScreen() {
  const { ratingId } = useLocalSearchParams<{ ratingId: string }>();
  return <ReviewLikes ratingId={ratingId} />;
}
