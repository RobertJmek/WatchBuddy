import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { Easing, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { IconSymbol } from '@/components/icon-symbol';
import { PressScale } from '@/components/press-scale';
import { Pressable } from '@/components/pressable';
import { Step } from '@/components/step';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticFailure, hapticSuccess } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import { useAuth } from '@/lib/auth-context';
import { markOnboardingSeen } from '@/lib/onboarding';
import { useBottomGap } from '@/hooks/use-bottom-gap';
import {
  getMyProfile,
  pickAvatarImage,
  saveProfile,
  saveProfileErrorMessage,
  PROFILE_LIMITS,
  usernameError,
  type PickedImage,
} from '@/lib/profile';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const rise = (step: number) => FadeInDown.duration(450).delay(step * 80).easing(EASE_OUT);

export default function OnboardingScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottomGap = useBottomGap();
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

  const field = [styles.field, { backgroundColor: c.backgroundElement }];

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
        bottomOffset={88 + Spacing.six}>
        <Animated.View entering={rise(0)} style={styles.intro}>
          <ThemedText type="title" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            Your profile
          </ThemedText>
          <ThemedText style={[styles.body, { color: c.textSecondary }]}>
            Help friends find you. You can change this later.
          </ThemedText>
        </Animated.View>

        <Animated.View entering={rise(1)} style={styles.steps}>
          <Step label="Photo">
            <Pressable
              style={styles.photoRow}
              onPress={pickAvatar}
              disabled={saving}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={avatarUri ? 'Change photo' : 'Choose a photo'}
              accessibilityState={{ disabled: saving }}>
              {avatarUri ? (
                <Avatar uri={avatarUri} name={displayName} size={72} />
              ) : (
                <View style={[styles.photoEmpty, { borderColor: c.textSecondary }]}>
                  <IconSymbol name="camera" size={24} tintColor={c.textSecondary} />
                </View>
              )}
              <ThemedText type="smallBold" style={{ color: c.tint }}>
                {avatarUri ? 'Change photo' : 'Choose a photo'}
              </ThemedText>
            </Pressable>
          </Step>

          <Step label="Username" note="3 to 20 letters, numbers or _">
            <View style={field}>
              <ThemedText style={[styles.prefix, { color: c.textSecondary }]}>@</ThemedText>
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="username"
                placeholderTextColor={c.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                maxLength={PROFILE_LIMITS.username}
                value={username}
                editable={!saving}
                onChangeText={setUsername}
                accessibilityLabel="Username"
              />
            </View>
          </Step>

          <Step label="Name">
            <View style={field}>
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="Your name"
                placeholderTextColor={c.textSecondary}
                maxLength={PROFILE_LIMITS.displayName}
                value={displayName}
                editable={!saving}
                onChangeText={setDisplayName}
                textContentType="name"
                autoComplete="name"
                accessibilityLabel="Name"
              />
            </View>
          </Step>

          <Step label="Bio" note={`Optional, up to ${PROFILE_LIMITS.bio} characters`}>
            <View style={field}>
              <TextInput
                style={[styles.input, styles.bio, { color: c.text }]}
                placeholder="What do you like to watch?"
                placeholderTextColor={c.textSecondary}
                maxLength={PROFILE_LIMITS.bio}
                multiline
                value={bio}
                editable={!saving}
                onChangeText={setBio}
                accessibilityLabel="Bio"
              />
            </View>
          </Step>

          {error && (
            <ThemedText themeColor="danger" accessibilityLiveRegion="polite">
              {error}
            </ThemedText>
          )}
        </Animated.View>
      </KeyboardAwareScrollView>

      <View style={[styles.bottom, { paddingBottom: bottomGap }]}>
        <PressScale
          style={[styles.primaryBtn, saving && styles.busy]}
          onPress={handleContinue}
          disabled={saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving, busy: saving }}>
          <ThemedText style={styles.primaryText}>{saving ? 'Saving…' : 'Continue'}</ThemedText>
        </PressScale>
      </View>
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
  intro: { gap: 12 },
  body: { fontSize: 17, lineHeight: 26 },
  steps: { gap: Spacing.five },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, alignSelf: 'flex-start' },
  photoEmpty: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The tutorial's search field: one rounded row, an optional prefix inside.
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  prefix: { fontFamily: Type.body, fontSize: 16 },
  input: { flex: 1, fontFamily: Type.body, fontSize: 16, paddingVertical: 14 },
  bio: { minHeight: 88, textAlignVertical: 'top' },
  bottom: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  primaryBtn: {
    backgroundColor: Accent,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  busy: { opacity: 0.6 },
  primaryText: { color: AccentText, fontWeight: '700', fontSize: 16 },
});
