import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ReviewRow } from '@/components/review-row';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { FeedActor, FeedItem } from '@/lib/feed';

function actorName(a: FeedActor) {
  return a.display_name?.trim() || (a.username ? `@${a.username}` : 'Someone');
}

/** Absolute date + time in the device's locale and timezone (timestamptz is UTC). */
export function formatEventTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Avatar({ actor, size = 36 }: { actor: FeedActor; size?: number }) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (actor.avatar_url) {
    return (
      <Image
        style={[styles.avatar, dim]}
        source={{ uri: actor.avatar_url }}
        contentFit="cover"
        transition={150}
      />
    );
  }
  const initial = actorName(actor).replace('@', '').charAt(0).toUpperCase() || '?';
  return (
    <View style={[styles.avatar, styles.avatarFallback, dim]}>
      <ThemedText style={styles.avatarInitial}>{initial}</ThemedText>
    </View>
  );
}

/**
 * A single feed entry. Review events reuse `ReviewRow` (inline like + tap into
 * the thread); every other event is a compact avatar + sentence that taps
 * through to the relevant title, profile, or review thread.
 */
export function FeedRow({ item }: { item: FeedItem }) {
  const router = useRouter();
  const c = useTheme();

  const openTitle = (t: { tmdbId: number; mediaType: 'movie' | 'tv'; name: string }) =>
    router.push({
      pathname: '/title/[id]',
      params: { id: String(t.tmdbId), type: t.mediaType, name: t.name },
    });
  const openUser = (id: string) =>
    router.push({ pathname: '/user/[id]', params: { id } });
  const openThread = (ratingId: string) =>
    router.push({ pathname: '/review/[ratingId]', params: { ratingId } });

  // Reviews get the full card, with its own like + thread affordances. In the
  // feed we also pass the title (tappable), since there's no title context
  // around the card.
  if (item.type === 'review') {
    return (
      <ReviewRow
        review={item.review}
        titleName={item.title?.name}
        onTitlePress={item.title ? () => openTitle(item.title!) : undefined}
      />
    );
  }

  let onPress: () => void;
  let body: React.ReactNode;
  const strong = (t: string) => (
    <ThemedText type="smallBold">{t}</ThemedText>
  );

  switch (item.type) {
    case 'episode_watch':
      onPress = () => openTitle(item.title);
      body = (
        <ThemedText type="small">
          {strong(actorName(item.actor))} watched {item.count}{' '}
          {item.count === 1 ? 'episode' : 'episodes'} of {strong(item.title.name)}
        </ThemedText>
      );
      break;
    case 'movie_watch':
      onPress = () => openTitle(item.title);
      body = (
        <ThemedText type="small">
          {strong(actorName(item.actor))} watched {strong(item.title.name)}
        </ThemedText>
      );
      break;
    case 'rating':
      onPress = () => openTitle(item.title);
      body = (
        <ThemedText type="small">
          {strong(actorName(item.actor))} rated {strong(item.title.name)}{' '}
          {item.value}/10
        </ThemedText>
      );
      break;
    case 'follow':
      onPress = () => openUser(item.target.id);
      body = (
        <ThemedText type="small">
          {strong(actorName(item.actor))} followed {strong(actorName(item.target))}
        </ThemedText>
      );
      break;
    case 'like':
      onPress = () => openThread(item.ratingId);
      body = (
        <ThemedText type="small">
          {strong(actorName(item.actor))} liked a review
          {item.titleName ? <> of {strong(item.titleName)}</> : null}
        </ThemedText>
      );
      break;
    case 'reply':
      onPress = () => openThread(item.ratingId);
      body = (
        <ThemedText type="small">
          {strong(actorName(item.actor))} replied to a review
          {item.titleName ? <> of {strong(item.titleName)}</> : null}
        </ThemedText>
      );
      break;
  }

  return (
    <Pressable
      style={[styles.row, { backgroundColor: c.backgroundElement }]}
      onPress={onPress}>
      <Avatar actor={item.actor} />
      <View style={styles.body}>
        {body}
        <ThemedText type="small" style={{ color: c.textSecondary }}>
          {formatEventTime(item.createdAt)}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  body: { flex: 1, gap: Spacing.half },
  avatar: { backgroundColor: PlaceholderBg },
  avatarFallback: { backgroundColor: Accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: AccentText, fontSize: 15, lineHeight: 19, fontWeight: '700' },
});
