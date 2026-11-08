import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { Easing, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarButton, BottomBar } from '@/components/bottom-bar';
import { Intro } from '@/components/intro';
import { BIO_MIN_HEIGHT, ProfileFields } from '@/components/profile-fields';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticFailure, hapticSuccess } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import { useAuth } from '@/lib/auth-context';
import { markOnboardingSeen } from '@/lib/onboarding';
import {
  getMyProfile,
  pickAvatarImage,
  saveProfile,
  saveProfileErrorMessage,
  usernameError,
  type PickedImage,
} from '@/lib/profile';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const rise = (step: number) => FadeInDown.duration(450).delay(step * 80).easing(EASE_OUT);

export default function OnboardingScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { session } = useAuth();

  const { data: profile } = useQuery({
    queryKey: keys.profile(),
    queryFn: getMyProfile,
  });

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [picked, setPicked] = useState<PickedImage | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the display name from the auto-created profile. Without a provider name
  // it is a random one ("Sleepy Usher 512", the new-user trigger's fallback since
  // migration 0022) — pre-filling lets the user replace it instead of starting blank. Seed once: a
  // background refetch must not overwrite edits the user is typing.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !profile) return;
    seeded.current = true;
    setDisplayName(profile.display_name ?? '');
    setUsername(profile.username ?? '');
    setBio(profile.bio ?? '');
  }, [profile]);

  const avatarUri = picked?.uri ?? profile?.avatar_url ?? null;

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
    // A new account's next stop is the tutorial (ADR 0028); it goes on to '/'.
    router.replace('/tutorial');
  }

  async function pickAvatar() {
    const image = await pickAvatarImage();
    if (image) setPicked(image);
  }

  async function handleContinue() {
    const name = displayName.trim();
    const handle = username.trim().toLowerCase();

    // Username is suggested, not required — but if given it must be valid/free.
    const invalid = usernameError(handle);
    if (invalid) {
      setError(invalid);
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await saveProfile(
        {
          display_name: name || null,
          username: handle || null,
          bio: bio.trim() || null,
        },
        picked,
      );
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: keys.profile() });
      await finish();
    } catch (e) {
      hapticFailure();
      setError(saveProfileErrorMessage(e));
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={[styles.top, { paddingTop: insets.top + Spacing.two }]}>
        <Pressable
          onPress={finish}
          disabled={saving}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Skip for now"
          accessibilityState={{ disabled: saving }}>
          <ThemedText type="smallBold" style={{ color: c.textSecondary }}>
            Skip
          </ThemedText>
        </Pressable>
      </View>

      {/* Same measures as a tutorial card: 24pt sides, 12pt inside a group,
          32pt between groups, an unnumbered Step per field. */}
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // Scrolls to the caret: clear the whole bio box (minHeight 88) plus the
        // hide-keyboard button above the keyboard.
        bottomOffset={BIO_MIN_HEIGHT + Spacing.six}>
        <Intro
          entering={rise(0)}
          title="Your profile"
          body="Help friends find you. You can change this later."
        />

        <Animated.View entering={rise(1)} style={styles.steps}>
          <ProfileFields
            avatarUri={avatarUri}
            username={username}
            displayName={displayName}
            bio={bio}
            onUsername={setUsername}
            onDisplayName={setDisplayName}
            onBio={setBio}
            onPickAvatar={pickAvatar}
            saving={saving}
            error={error}
          />
        </Animated.View>
      </KeyboardAwareScrollView>

      <BottomBar>
        <BarButton title={saving ? 'Saving…' : 'Continue'} onPress={handleContinue} busy={saving} />
      </BottomBar>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { alignItems: 'flex-end', paddingHorizontal: Spacing.four },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
    gap: Spacing.five,
  },
  steps: { gap: Spacing.five },
});
