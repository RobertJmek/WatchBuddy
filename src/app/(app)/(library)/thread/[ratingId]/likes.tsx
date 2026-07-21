import { useLocalSearchParams } from 'expo-router';

import { ReviewLikes } from '@/components/review-likes';

// Library-nested "Liked by" — keeps the tab bar. Root twin:
// /review/[ratingId]/likes. See ADR 0005.
export default function LibraryThreadLikesScreen() {
  const { ratingId } = useLocalSearchParams<{ ratingId: string }>();
  return <ReviewLikes ratingId={ratingId} />;
}
