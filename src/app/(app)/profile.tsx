import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Danger, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { getMyProfile } from '@/lib/profile';
import { useThemePreference } from '@/lib/theme-preference';

const THEME_LABEL = { light: 'Light', dark: 'Dark', system: 'System' } as const;

export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const { pref, cycle } = useThemePreference();
  const c = useTheme();
  const router = useRouter();

  const { data: profile, refetch } = useQuery({
    queryKey: ['profile'],
    queryFn: getMyProfile,
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
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

        <Pressable
          style={[styles.editBtn, { borderColor: c.border }]}
          onPress={() => router.push('/edit-profile')}>
          <ThemedText type="smallBold" style={{ color: Accent }}>
            Edit Profile
          </ThemedText>
        </Pressable>

        <Pressable style={styles.link} onPress={() => router.push('/diary')}>
          <ThemedText type="subtitle">Diary</ThemedText>
          <ThemedText style={styles.chevron}>›</ThemedText>
        </Pressable>
        <Pressable style={styles.link} onPress={cycle}>
          <ThemedText type="subtitle">Theme</ThemedText>
          <ThemedView style={styles.value}>
            <ThemedText type="small">{THEME_LABEL[pref]}</ThemedText>
            <ThemedText style={styles.chevron}>›</ThemedText>
          </ThemedView>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.signOutBtn, pressed && styles.pressed]}
          onPress={signOut}>
          <ThemedText type="smallBold" style={styles.signOutText}>
            Sign out
          </ThemedText>
        </Pressable>
      </SafeAreaView>
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
  heading: { marginTop: Spacing.three },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#0002' },
  avatarFallback: {
    backgroundColor: Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: '#fff', fontSize: 26, fontWeight: '700' },
  identityText: { flex: 1, gap: Spacing.half },
  bio: { lineHeight: 21 },
  editBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  chevron: { opacity: 0.4, fontSize: 20 },
  value: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  signOutBtn: {
    marginTop: Spacing.two,
    borderWidth: 1,
    borderColor: Danger,
    borderRadius: 999,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  signOutText: { color: Danger },
  pressed: { opacity: 0.6 },
});
