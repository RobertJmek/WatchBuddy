import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { FollowButton } from '@/components/follow-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { UserResult } from '@/lib/social';

/** A person row with avatar, name, @handle and a Follow toggle; taps to profile. */
export function UserRow({ user }: { user: UserResult }) {
  const router = useRouter();
  const c = useTheme();
  const name =
    user.display_name?.trim() ||
    (user.username ? `@${user.username}` : 'User');
  const initial = (name.replace('@', '') || '?').charAt(0).toUpperCase();

  return (
    <Pressable
      style={[styles.row, { backgroundColor: c.backgroundElement }]}
      onPress={() =>
        router.push({ pathname: '/user/[id]', params: { id: user.id } })
      }>
      {user.avatar_url ? (
        <Image
          style={styles.avatar}
          source={{ uri: user.avatar_url }}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <ThemedText style={styles.avatarInitial}>{initial}</ThemedText>
        </View>
      )}
      <ThemedView style={styles.rowText}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {name}
        </ThemedText>
        {user.username ? (
          <ThemedText type="small">@{user.username}</ThemedText>
        ) : null}
      </ThemedView>
      <FollowButton userId={user.id} initialFollowing={user.is_following} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
    padding: Spacing.two,
    borderRadius: Spacing.three,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#0002' },
  avatarFallback: {
    backgroundColor: Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: '#fff', fontSize: 18, fontWeight: '700' },
  rowText: { flex: 1, gap: Spacing.half, backgroundColor: 'transparent' },
});
