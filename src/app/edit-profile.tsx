import { useQuery, useQueryClient } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import { Stack, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { BarButton, BottomBar } from '@/components/bottom-bar';
import { Intro } from '@/components/intro';
import { BIO_MIN_HEIGHT, ProfileFields } from '@/components/profile-fields';
import { RowLink } from '@/components/row-link';
import { RowSkeletonList } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { keys } from '@/lib/keys';
import { useAuth } from '@/lib/auth-context';
import { buildExport } from '@/lib/export';
import { hapticFailure, hapticSuccess } from '@/lib/haptics';
import {
  getMyProfile,
  pickAvatarImage,
  saveProfile,
  saveProfileErrorMessage,
  usernameError,
  type PickedImage,
} from '@/lib/profile';

export default function EditProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { deleteAccount } = useAuth();

  // Two explicit gates — deletion is irreversible, one tap must never do it.
  function confirmDeleteAccount() {
    Alert.alert(
      'Delete account?',
      'This permanently erases your profile, library, watch history, ratings and follows. There is no undo.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'Are you absolutely sure?',
              'Your account and every trace of your activity will be gone forever, right now.',
              [
                { text: 'Keep my account', style: 'cancel' },
                {
                  text: 'Delete forever',
                  style: 'destructive',
                  onPress: async () => {
                    const { error } = await deleteAccount();
                    if (error) Alert.alert('Could not delete account', error);
                  },
                },
              ],
            ),
        },
      ],
    );
  }

  const { data: profile, isLoading } = useQuery({
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
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GDPR-style export: one JSON with everything the account stores, handed to
  // the share sheet (save to Files, AirDrop, email, …).
  async function exportMyData() {
    setExporting(true);
    try {
      const data = await buildExport();
      const file = new File(
        Paths.cache,
        `watchbuddy-export-${new Date().toISOString().slice(0, 10)}.json`,
      );
      // Overwrite a leftover file from an earlier export the same day.
      file.create({ overwrite: true, intermediates: true });
      file.write(JSON.stringify(data, null, 2));
      hapticSuccess();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Your WatchBuddy data',
        });
      } else {
        Alert.alert('Export saved', `Your data was written to:\n${file.uri}`);
      }
    } catch (e) {
      console.error('export:', e);
      hapticFailure();
      Alert.alert(
        'Export failed',
        e instanceof Error ? e.message : 'Could not export your data. Try again.',
      );
    } finally {
      setExporting(false);
    }
  }

  // Seed the form once the profile loads.
  /* eslint-disable react-hooks/set-state-in-effect -- the fields are user-
     editable, so they must be state; seeding them is the one moment the
     server's copy wins. */
  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? '');
    setUsername(profile.username ?? '');
    setBio(profile.bio ?? '');
  }, [profile]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const avatarUri = picked?.uri ?? profile?.avatar_url ?? null;

  async function pickAvatar() {
    const image = await pickAvatarImage();
    if (image) setPicked(image);
  }

  async function handleSave() {
    const name = displayName.trim();
    const handle = username.trim().toLowerCase();
    const about = bio.trim();

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
          bio: about || null,
        },
        picked,
      );
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: keys.profile() });
      router.back();
    } catch (e) {
      hapticFailure();
      setError(saveProfileErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || exporting;

  return (
    <ThemedView style={styles.container}>
      {/* No header title: the Intro is the title (ADR 0030). */}
      <Stack.Screen options={{ headerShown: true, title: '' }} />
      {isLoading ? (
        <RowSkeletonList />
      ) : (
        <>
          {/* Keyboard-aware like sign-in and the first-run screens: the focused
              field (the bio, low on the page) scrolls above the keyboard, with
              room left for the root's hide-keyboard button. */}
          <KeyboardAwareScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            // Scrolls to the caret: clear the whole bio box plus the
            // hide-keyboard button above the keyboard.
            bottomOffset={BIO_MIN_HEIGHT + Spacing.six}>
            <Intro title="Edit profile" body="This is how friends see you." />

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

            <View style={styles.group}>
              <ThemedText type="subtitle" accessibilityRole="header">
                Your data
              </ThemedText>
              <View>
                <RowLink
                  label="Import your data"
                  disabled={busy}
                  onPress={() => router.push('/import-data')}
                />
                <RowLink
                  label="Blocked accounts"
                  disabled={busy}
                  onPress={() => router.push('/blocked')}
                />
                <RowLink
                  label="Export your data"
                  disabled={busy}
                  busy={exporting}
                  onPress={exportMyData}
                />
              </View>
            </View>

            <Pressable
              onPress={confirmDeleteAccount}
              disabled={saving}
              hitSlop={8}
              style={styles.deleteRow}
              accessibilityRole="button"
              accessibilityLabel="Delete account"
              accessibilityState={{ disabled: saving }}>
              <ThemedText type="small" themeColor="danger">
                Delete account…
              </ThemedText>
            </Pressable>
          </KeyboardAwareScrollView>

          {/* Pinned Save (ADR 0030): a Save in the scroll or the header is the
              button people miss. It sits at the bottom gap, the lowest any
              button goes. */}
          <BottomBar>
            <BarButton title={saving ? 'Saving…' : 'Save'} onPress={handleSave} busy={saving} />
          </BottomBar>
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  // The tutorial-card measures: 24pt sides, 12 inside a group, 32 between groups.
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
    gap: Spacing.five,
  },
  group: { gap: 12 },
  deleteRow: { alignSelf: 'center' },
});
