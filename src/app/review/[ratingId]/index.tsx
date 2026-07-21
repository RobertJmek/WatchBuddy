import { useLocalSearchParams } from 'expo-router';

import { ReviewThread } from '@/components/review-thread';

// Root screen (covers the tab bar) — reached from a title's review list.
// The Library-nested twin lives at /thread/[ratingId]; see ADR 0005.
export default function ReviewThreadScreen() {
  const { ratingId } = useLocalSearchParams<{ ratingId: string }>();
  return <ReviewThread ratingId={ratingId} variant="root" />;
}
