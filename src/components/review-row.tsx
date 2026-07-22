import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { IconSymbol } from '@/components/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { likeReview, unlikeReview, type ReviewItem } from '@/lib/ratings';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * A single community review: author, score, text — taps through to the
 * profile. `showThreadAction` adds the 💬 reply-count button (off on the
 * thread screen itself, where the row is the header).
 */
export function ReviewRow({
  review,
  showThreadAction = true,
  titleName,
  onTitlePress,
}: {
  review: ReviewItem;
  showThreadAction?: boolean;
  /** Shown next to the author in feed context, where the card has no title. */
  titleName?: string;
  /** Makes the title tappable (navigates to the title) in feed context. */
  onTitlePress?: () => void;
}) {
  const router = useRouter();
  const c = useTheme();
  const queryClient = useQueryClient();

  // Optimistic like state; the server truth arrives on the next refetch.
  const [liked, setLiked] = useState(review.likedByMe);
  const [likes, setLikes] = useState(review.likeCount);

  // Long-press on the heart shows who liked (only when there's someone).
  function openLikers() {
    if (likes === 0) return;
    router.push({
      pathname: '/review/[ratingId]/likes',
      params: { ratingId: review.ratingId },
    });
  }

  async function toggleLike() {
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      if (next) await likeReview(review.ratingId);
      else await unlikeReview(review.ratingId);
      queryClient.invalidateQueries({ queryKey: ['titleRatings'] });
      // Keep the feed's copy of this review's heart in sync (no-op off-feed).
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    } catch {
      setLiked(!next);
      setLikes((n) => n + (next ? -1 : 1));
    }
  }
  const name =
    review.display_name?.trim() ||
    (review.username ? `@${review.username}` : 'User');
  const initial = (name.replace('@', '') || '?').charAt(0).toUpperCase();

  return (
    <Pressable
      style={[styles.card, { backgroundColor: c.backgroundElement }]}
      onPress={() =>
        router.push({ pathname: '/user/[id]', params: { id: review.userId } })
      }>
      <View style={styles.top}>
        {review.avatar_url ? (
          <Image
            style={styles.avatar}
            source={{ uri: review.avatar_url }}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <ThemedText style={styles.avatarInitial}>{initial}</ThemedText>
          </View>
        )}
        <View style={styles.who}>
          <View style={styles.nameLine}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
              {name}
            </ThemedText>
            {titleName ? (
              <Pressable onPress={onTitlePress} hitSlop={6} disabled={!onTitlePress}>
                <ThemedText type="small" numberOfLines={1}>
                  <ThemedText type="small" style={{ color: c.textSecondary }}>
                    on{' '}
                  </ThemedText>
                  <ThemedText type="smallBold">{titleName}</ThemedText>
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
          <ThemedText type="small" style={{ color: c.textSecondary }}>
            {review.username ? `@${review.username}` : ''}
            {review.isMine ? ' · You' : review.is_following ? ' · Following' : ''}
          </ThemedText>
        </View>
        <View style={[styles.score, { borderColor: c.glow }]}>
          <ThemedText type="smallBold" style={{ color: c.glow }}>
            {review.value}
          </ThemedText>
        </View>
      </View>

      <ThemedText style={styles.text}>{review.review}</ThemedText>
      <View style={styles.footer}>
        <ThemedText type="small" style={[styles.date, { color: c.textSecondary }]}>
          {formatDate(review.updated_at)}
        </ThemedText>
        <View style={styles.actions}>
        {showThreadAction && (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/review/[ratingId]',
                params: { ratingId: review.ratingId },
              })
            }
            hitSlop={10}
            style={styles.likeBtn}>
            <IconSymbol name="bubble" size={16} tintColor={c.textSecondary} />
            {review.replyCount > 0 && (
              <ThemedText type="small" style={{ color: c.textSecondary }}>
                {review.replyCount}
              </ThemedText>
            )}
          </Pressable>
        )}
        {review.isMine ? (
          // Own review: display-only counter (no self-likes); long-press
          // opens the Liked-by list.
          likes > 0 && (
            <Pressable
              onLongPress={openLikers}
              hitSlop={10}
              style={styles.likeBtn}>
              <IconSymbol name="heart" size={16} tintColor={c.textSecondary} />
              <ThemedText type="small" style={{ color: c.textSecondary }}>
                {likes}
              </ThemedText>
            </Pressable>
          )
        ) : (
          <Pressable
            onPress={toggleLike}
            onLongPress={openLikers}
            hitSlop={10}
            style={styles.likeBtn}>
            <IconSymbol
              name="heart"
              size={16}
              tintColor={liked ? Accent : c.textSecondary}
            />
            {likes > 0 && (
              <ThemedText
                type="small"
                style={{ color: liked ? Accent : c.textSecondary }}>
                {likes}
              </ThemedText>
            )}
          </Pressable>
        )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: PlaceholderBg },
  avatarFallback: {
    backgroundColor: Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: AccentText, fontSize: 15, lineHeight: 19, fontWeight: '700' },
  who: { flex: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one },
  name: { flexShrink: 1 },
  score: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { lineHeight: 21 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  date: { opacity: 0.8 },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
