import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { IconSymbol } from '@/components/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopSafeAreaView } from '@/components/top-safe-area';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { keys } from '@/lib/keys';
import { useAuth } from '@/lib/auth-context';
import { getMyProfile } from '@/lib/profile';
import { getFollowCounts } from '@/lib/social';
import { useThemePreference } from '@/lib/theme-preference';

const THEME_LABEL = { light: 'Light', dark: 'Dark', system: 'System' } as const;

export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const { pref, cycle } = useThemePreference();
  const c = useTheme();
  const router = useRouter();

  const myId = session?.user.id;

  const { data: profile, refetch } = useQuery({
    queryKey: keys.profile(),
    queryFn: getMyProfile,
  });

  const { data: counts, refetch: refetchCounts } = useQuery({
    queryKey: keys.followCounts(myId),
    queryFn: () => getFollowCounts(myId!),
    enabled: !!myId,
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
      refetchCounts();
    }, [refetch, refetchCounts]),
  );

  const email = session?.user.email ?? '';
  const name = profile?.display_name?.trim() || email;

  return (
    <ThemedView style={styles.container}>
      <TopSafeAreaView style={styles.safeArea}>
        <View style={styles.headingRow}>
          <ThemedText type="title">Profile</ThemedText>
          {/* Version, build and the policy pages. Nothing here is needed while
              using the app, so it sits behind one tap instead of taking up the
              bottom of this screen. */}
          <Pressable
            onPress={() => router.push('/about')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="About WatchBuddy">
            <IconSymbol name="info.circle" size={22} tintColor={c.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.identity}>
          <Avatar uri={profile?.avatar_url} name={name} size={64} />
          <View style={styles.identityText}>
            <ThemedText type="subtitle" numberOfLines={1}>
              {name}
            </ThemedText>
            {profile?.username ? (
              <ThemedText type="small" style={{ color: c.textSecondary }}>
                @{profile.username}
              </ThemedText>
            ) : null}
          </View>
        </View>

        {profile?.bio ? (
          <ThemedText style={styles.bio}>{profile.bio}</ThemedText>
        ) : null}

        {myId ? (
          <View style={styles.counts}>
            <Pressable
              style={styles.countItem}
              onPress={() =>
                router.push({
                  pathname: '/user/[id]/followers',
                  params: { id: myId },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`${counts?.followers ?? 0} followers`}>
              <ThemedText type="smallBold">{counts?.followers ?? 0}</ThemedText>
              <ThemedText type="small" style={{ color: c.textSecondary }}>
                {' followers'}
              </ThemedText>
            </Pressable>
            <Pressable
              style={styles.countItem}
              onPress={() =>
                router.push({
                  pathname: '/user/[id]/following',
                  params: { id: myId },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`Following ${counts?.following ?? 0} people`}>
              <ThemedText type="smallBold">{counts?.following ?? 0}</ThemedText>
              <ThemedText type="small" style={{ color: c.textSecondary }}>
                {' following'}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        <Button
          title="Edit Profile"
          variant="outline"
          onPress={() => router.push('/edit-profile')}
        />

        <Pressable
          style={[styles.link, { borderBottomColor: c.border }]}
          onPress={() =>
            myId &&
            router.push({ pathname: '/user/[id]', params: { id: myId } })
          }
          accessibilityRole="button">
          <ThemedText type="subtitle">View my profile</ThemedText>
          <IconSymbol name="chevron.right" size={18} tintColor={c.textSecondary} />
        </Pressable>
        <Pressable
          style={[styles.link, { borderBottomColor: c.border }]}
          onPress={() => router.push('/stats')}
          accessibilityRole="button">
          <ThemedText type="subtitle">Statistics</ThemedText>
          <IconSymbol name="chevron.right" size={18} tintColor={c.textSecondary} />
        </Pressable>
        <Pressable
          style={[styles.link, { borderBottomColor: c.border }]}
          onPress={() => router.push('/diary')}
          accessibilityRole="button">
          <ThemedText type="subtitle">Diary</ThemedText>
          <IconSymbol name="chevron.right" size={18} tintColor={c.textSecondary} />
        </Pressable>
        <Pressable
          style={[styles.link, { borderBottomColor: c.border }]}
          onPress={cycle}
          accessibilityRole="button"
          accessibilityLabel={`Theme: ${THEME_LABEL[pref]}`}
          accessibilityHint="Cycles between light, dark and system">
          <ThemedText type="subtitle">Theme</ThemedText>
          <ThemedView style={styles.value}>
            <ThemedText type="small">{THEME_LABEL[pref]}</ThemedText>
            <IconSymbol name="chevron.right" size={18} tintColor={c.textSecondary} />
          </ThemedView>
        </Pressable>

        <Button
          title="Sign out"
          variant="danger"
          style={{ marginTop: Spacing.two }}
          onPress={signOut}
        />
      </TopSafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  // The top margin lives on the row, not on the title: with it on the child,
  // `alignItems: center` would measure the title's margin box and sit the ⓘ
  // above the text it belongs beside.
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.three,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  identityText: { flex: 1, gap: Spacing.half },
  bio: { lineHeight: 21 },
  counts: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  countItem: { flexDirection: 'row', alignItems: 'center' },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  value: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
});
