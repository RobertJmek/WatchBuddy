import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { follow, unfollow } from '@/lib/social';

/**
 * Optimistic Follow/Following pill. Callers pass the known initial state (lists
 * and profiles already fetch it) so there's no per-button network round-trip.
 * `onChange` lets a parent adjust follower counts immediately.
 */
export function FollowButton({
  userId,
  initialFollowing,
  onChange,
}: {
  userId: string;
  initialFollowing: boolean;
  onChange?: (following: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const c = useTheme();
  const [following, setFollowing] = useState(initialFollowing);
  const [saving, setSaving] = useState(false);

  // Keep in sync if the row is recycled / refetched with a new state.
  useEffect(() => setFollowing(initialFollowing), [initialFollowing]);

  async function toggle() {
    if (saving) return;
    const next = !following;
    setFollowing(next); // optimistic
    setSaving(true);
    onChange?.(next);
    try {
      if (next) await follow(userId);
      else await unfollow(userId);
      queryClient.invalidateQueries({ queryKey: ['follow', userId] });
      queryClient.invalidateQueries({ queryKey: ['followCounts'] });
    } catch {
      setFollowing(!next); // revert
      onChange?.(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      style={({ pressed }) => [
        styles.pill,
        following
          ? { borderColor: c.border, borderWidth: 1 }
          : { backgroundColor: Accent },
        pressed && styles.pressed,
      ]}>
      <ThemedText
        type="smallBold"
        style={{ color: following ? c.textSecondary : '#fff' }}>
        {following ? 'Following' : 'Follow'}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
  },
  pressed: { opacity: 0.6 },
});
