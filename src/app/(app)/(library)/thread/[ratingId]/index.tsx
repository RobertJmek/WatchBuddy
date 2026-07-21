import { useLocalSearchParams } from 'expo-router';

import { ReviewThread } from '@/components/review-thread';

// Library-nested thread — keeps the native tab bar visible (reached from a
// notification). Root twin: /review/[ratingId]. See ADR 0005.
export default function LibraryThreadScreen() {
  const { ratingId } = useLocalSearchParams<{ ratingId: string }>();
  return <ReviewThread ratingId={ratingId} variant="library" />;
}
