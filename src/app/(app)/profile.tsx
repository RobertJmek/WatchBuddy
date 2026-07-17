import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { IconSymbol } from '@/components/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { getMyProfile } from '@/lib/profile';
import { getFollowCounts } from '@/lib/social';
import { useThemePreference } from '@/lib/theme-preference';

const THEME_LABEL = { light: 'Light', dark: 'Dark', system: 'System' } as const;

export default function ProfileScreen() {
  const { session, signOut, deleteAccount } = useAuth();

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete account?',
      'This permanently erases your profile, library, watch history, ratings and follows. There is no undo.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete forever',
          style: 'destructive',
          onPress: async () => {
            const { error } = await deleteAccount();
            if (error) Alert.alert('Could not delete account', error);
          },
        },
      ],
    );
  }
  const { pref, cycle } = useThemePreference();
  const c = useTheme();
  const router = useRouter();

  const myId = session?.user.id;

  const { data: profile, refetch } = useQuery({
    queryKey: ['profile'],
    queryFn: getMyProfile,
  });

  const { data: counts, refetch: refetchCounts } = useQuery({
    queryKey: ['followCounts', myId],
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
  const initial = (name || '?').charAt(0).toUpperCase();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedText type="title" style={styles.heading}>
          Profile
        </ThemedText>

        <View style={styles.identity}>
          {profile?.avatar_url ? (
            <Image
              style={styles.avatar}
              source={{ uri: profile.avatar_url }}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <ThemedText style={styles.avatarInitial}>{initial}</ThemedText>
            </View>
          )}
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
              }>
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
              }>
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
          }>
          <ThemedText type="subtitle">View my profile</ThemedText>
          <IconSymbol name="chevron.right" size={18} tintColor={c.textSecondary} />
        </Pressable>
        <Pressable style={[styles.link, { borderBottomColor: c.border }]} onPress={() => router.push('/diary')}>
          <ThemedText type="subtitle">Diary</ThemedText>
          <IconSymbol name="chevron.right" size={18} tintColor={c.textSecondary} />
        </Pressable>
        <Pressable style={[styles.link, { borderBottomColor: c.border }]} onPress={cycle}>
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
        <Pressable onPress={confirmDeleteAccount} hitSlop={8}>
          <ThemedText
            type="small"
            style={[styles.deleteLink, { color: c.textSecondary }]}>
            Delete account…
          </ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  deleteLink: { textAlign: 'center', marginTop: Spacing.three },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  heading: { marginTop: Spacing.three },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: PlaceholderBg },
  avatarFallback: {
    backgroundColor: Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: AccentText, fontSize: 26, lineHeight: 32, fontWeight: '700' },
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
