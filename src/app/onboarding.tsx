import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, Danger, PlaceholderBg, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { markOnboardingSeen } from '@/lib/onboarding';
import {
  getMyProfile,
  updateProfile,
  uploadAvatar,
  UsernameTakenError,
} from '@/lib/profile';

// Same rule the Edit Profile screen enforces: 3–20 chars, a–z / 0–9 / _.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export default function OnboardingScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { session } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: getMyProfile,
  });

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [picked, setPicked] = useState<{ uri: string; mimeType?: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the display name from the auto-created profile. On email sign-up this is
  // the email address (the new-user trigger's fallback) — pre-filling lets the
  // user replace it with a real name instead of starting blank. Seed once: a
  // background refetch must not overwrite edits the user is typing.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !profile) return;
    seeded.current = true;
    setDisplayName(profile.display_name ?? '');
    setUsername(profile.username ?? '');
  }, [profile]);

  const avatarUri = picked?.uri ?? profile?.avatar_url ?? null;
  const initial = (displayName.trim() || '?').charAt(0).toUpperCase();

  async function finish() {
    // Best-effort: a failed local-storage write must not trap the user on this
    // screen (worst case the gate re-suggests onboarding next launch).
    if (session) {
      try {
        await markOnboardingSeen(session.user.id);
      } catch {
        // ignore — navigate regardless
      }
    }
    router.replace('/');
  }

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo access is needed to choose a picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      setPicked({ uri: asset.uri, mimeType: asset.mimeType ?? undefined });
    }
  }

  async function handleContinue() {
    const name = displayName.trim();
    const handle = username.trim().toLowerCase();

    // Username is suggested, not required — but if given it must be valid/free.
    if (handle && !USERNAME_RE.test(handle)) {
      setError('Username must be 3–20 characters: a–z, 0–9 or _.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const avatar_url = picked
        ? await uploadAvatar(picked.uri, picked.mimeType)
        : undefined;
      await updateProfile({
        display_name: name || null,
        username: handle || null,
        bio: profile?.bio ?? null,
        ...(avatar_url ? { avatar_url } : {}),
      });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      await finish();
    } catch (e) {
      setError(
        e instanceof UsernameTakenError ? e.message : 'Could not save. Try again.',
      );
      setSaving(false);
    }
  }

  const inputStyle = [
    styles.input,
    { color: c.text, backgroundColor: c.backgroundElement },
  ];

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.five, paddingBottom: insets.bottom + Spacing.four },
        ]}
        keyboardShouldPersistTaps="handled">
        <ThemedText type="title" style={styles.heading}>
          Let friends find you
        </ThemedText>
        <ThemedText type="small" style={[styles.subtitle, { color: c.textSecondary }]}>
          Pick a username and a photo so people you know can search for you, follow
          your diary and see what you rate. You can change these anytime in your
          profile.
        </ThemedText>

        <View style={styles.avatarSection}>
          {avatarUri ? (
            <Image
              style={styles.avatar}
              source={{ uri: avatarUri }}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <ThemedText style={styles.avatarInitial}>{initial}</ThemedText>
            </View>
          )}
          <Pressable onPress={pickAvatar} disabled={saving} hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: Accent }}>
              Add a photo
            </ThemedText>
          </Pressable>
        </View>

        <ThemedText type="smallBold">Display name</ThemedText>
        <TextInput
          style={inputStyle}
          placeholder="Your name"
          placeholderTextColor={c.textSecondary}
          value={displayName}
          editable={!saving}
          onChangeText={setDisplayName}
        />

        <ThemedText type="smallBold">Username</ThemedText>
        <TextInput
          style={inputStyle}
          placeholder="username"
          placeholderTextColor={c.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          editable={!saving}
          onChangeText={setUsername}
        />

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <Pressable
          style={[styles.primaryBtn, saving && styles.busy]}
          onPress={handleContinue}
          disabled={saving}>
          <ThemedText style={styles.primaryText}>
            {saving ? 'Saving…' : 'Continue'}
          </ThemedText>
        </Pressable>

        <Pressable
          onPress={finish}
          disabled={saving}
          hitSlop={8}
          style={styles.skipRow}>
          <ThemedText type="small" style={{ color: c.textSecondary }}>
            Skip for now
          </ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  heading: { textAlign: 'center' },
  subtitle: { textAlign: 'center', marginBottom: Spacing.three, marginTop: Spacing.one },
  avatarSection: { alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.three },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: PlaceholderBg },
  avatarFallback: {
    backgroundColor: Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: AccentText, fontSize: 38, lineHeight: 46, fontWeight: '700' },
  input: {
    fontFamily: Type.body,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginBottom: Spacing.two,
  },
  error: { color: Danger },
  primaryBtn: {
    backgroundColor: Accent,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  busy: { opacity: 0.6 },
  primaryText: { color: AccentText, fontWeight: '700', fontSize: 16 },
  skipRow: { alignItems: 'center', marginTop: Spacing.four },
});
