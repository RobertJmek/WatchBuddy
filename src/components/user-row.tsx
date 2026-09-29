import { useRouter } from 'expo-router';
import { memo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Avatar } from '@/components/avatar';
import { PressScale } from '@/components/press-scale';

import { FollowButton } from '@/components/follow-button';
import { useModerationMenu } from '@/components/moderation-menu';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { UserResult } from '@/lib/social';

/**
 * The Unblock pill on a row of the Blocked accounts list. Lifting the block
 * refetches the list, so the row leaves on its own.
 */
function UnblockButton({ user, name }: { user: UserResult; name: string }) {
  const c = useTheme();
  const { unblock } = useModerationMenu();
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      onPress={async () => {
        if (busy) return;
        setBusy(true);
        await unblock({ id: user.id, username: user.username, name });
        setBusy(false);
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Unblock ${name}`}
      accessibilityState={{ busy }}
      style={({ pressed }) => [
        styles.unblock,
        { borderColor: c.border },
        (pressed || busy) && styles.pressed,
      ]}>
      <ThemedText type="smallBold" style={{ color: c.textSecondary }}>
        Unblock
      </ThemedText>
    </Pressable>
  );
}

/**
 * A person row with avatar, name, @handle and a Follow toggle; taps to profile.
 * `variant="blocked"` swaps the toggle for Unblock (the Blocked accounts list) —
 * a primitive rather than a `trailing` node so the `memo` keeps holding.
 */
export const UserRow = memo(function UserRow({
  user,
  variant = 'follow',
}: {
  user: UserResult;
  variant?: 'follow' | 'blocked';
}) {
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
      }
      accessibilityRole="button"
      accessibilityLabel={`${name}, open profile`}>
      <Avatar uri={user.avatar_url} name={name} size={44} />
      <ThemedView style={styles.rowText}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {name}
        </ThemedText>
        {user.username ? (
          <ThemedText type="small">@{user.username}</ThemedText>
        ) : null}
      </ThemedView>
      {variant === 'blocked' ? (
        <UnblockButton user={user} name={name} />
      ) : (
        <FollowButton userId={user.id} initialFollowing={user.is_following} />
      )}
    </PressScale>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
    padding: Spacing.two,
    borderRadius: Spacing.three,
  },
  rowText: { flex: 1, gap: Spacing.half, backgroundColor: 'transparent' },
  unblock: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
});
