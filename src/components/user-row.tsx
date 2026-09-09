import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Avatar } from '@/components/avatar';
import { PressScale } from '@/components/press-scale';

import { FollowButton } from '@/components/follow-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { UserResult } from '@/lib/social';

/** A person row with avatar, name, @handle and a Follow toggle; taps to profile. */
export function UserRow({ user }: { user: UserResult }) {
  const router = useRouter();
  const c = useTheme();
  const name =
    user.display_name?.trim() ||
    (user.username ? `@${user.username}` : 'User');

  return (
    <PressScale
      style={[styles.row, { backgroundColor: c.backgroundElement }]}
      onPress={() =>
        router.push({ pathname: '/user/[id]', params: { id: user.id } })
      }>
      <Avatar uri={user.avatar_url} name={name} size={44} />
      <ThemedView style={styles.rowText}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {name}
        </ThemedText>
        {user.username ? (
          <ThemedText type="small">@{user.username}</ThemedText>
        ) : null}
      </ThemedView>
      <FollowButton userId={user.id} initialFollowing={user.is_following} />
    </PressScale>
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
  rowText: { flex: 1, gap: Spacing.half, backgroundColor: 'transparent' },
});
