import { useQuery, useQueryClient } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { IconSymbol } from '@/components/icon-symbol';
import { RowSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, Danger, PlaceholderBg, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { buildExport } from '@/lib/export';
import {
  getMyProfile,
  updateProfile,
  uploadAvatar,
  UsernameTakenError,
} from '@/lib/profile';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export default function EditProfileScreen() {
  const c = useTheme();
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
    queryKey: ['profile'],
    queryFn: getMyProfile,
  });

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [picked, setPicked] = useState<{ uri: string; mimeType?: string } | null>(
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
      Alert.alert(
        'Export failed',
        e instanceof Error ? e.message : 'Could not export your data. Try again.',
      );
    } finally {
      setExporting(false);
    }
  }

  // Seed the form once the profile loads.
  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? '');
    setUsername(profile.username ?? '');
    setBio(profile.bio ?? '');
  }, [profile]);

  const avatarUri = picked?.uri ?? profile?.avatar_url ?? null;
  const initial = (displayName.trim() || '?').charAt(0).toUpperCase();

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

  async function handleSave() {
    const name = displayName.trim();
    const handle = username.trim().toLowerCase();
    const about = bio.trim();

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
        bio: about || null,
        ...(avatar_url ? { avatar_url } : {}),
      });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      router.back();
    } catch (e) {
      setError(
        e instanceof UsernameTakenError ? e.message : 'Could not save. Try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = [
    styles.input,
    { color: c.text, backgroundColor: c.backgroundElement },
  ];

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Edit Profile' }} />
      {isLoading ? (
        <View style={{ padding: Spacing.three, gap: Spacing.two }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
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
            <Pressable onPress={pickAvatar} disabled={saving}>
              <ThemedText type="smallBold" style={{ color: Accent }}>
                Change photo
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

          <ThemedText type="smallBold">Bio</ThemedText>
          <TextInput
            style={[inputStyle, styles.bio]}
            placeholder="A little about you…"
            placeholderTextColor={c.textSecondary}
            multiline
            value={bio}
            editable={!saving}
            onChangeText={setBio}
          />

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <Pressable
            style={[styles.saveBtn, saving && styles.busy]}
            onPress={handleSave}
            disabled={saving}>
            <ThemedText style={styles.saveText}>
              {saving ? 'Saving…' : 'Save'}
            </ThemedText>
          </Pressable>

          <View style={styles.dataSection}>
            <Pressable
              style={[styles.link, { borderBottomColor: c.border }]}
              disabled={saving || exporting}
              onPress={() => router.push('/import-data')}>
              <ThemedText type="subtitle">Import your data</ThemedText>
              <IconSymbol
                name="chevron.right"
                size={18}
                tintColor={c.textSecondary}
              />
            </Pressable>
            <Pressable
              style={[styles.link, { borderBottomColor: c.border }]}
              disabled={saving || exporting}
              onPress={exportMyData}>
              <ThemedText type="subtitle">Export your data</ThemedText>
              {exporting ? (
                <ActivityIndicator size="small" />
              ) : (
                <IconSymbol
                  name="chevron.right"
                  size={18}
                  tintColor={c.textSecondary}
                />
              )}
            </Pressable>
          </View>

          <Pressable
            onPress={confirmDeleteAccount}
            disabled={saving}
            hitSlop={8}
            style={styles.deleteRow}>
            <ThemedText type="small" style={{ color: Danger }}>
              Delete account…
            </ThemedText>
          </Pressable>
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two },
  avatarSection: { alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.two },
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
  bio: { minHeight: 96, textAlignVertical: 'top' },
  error: { color: Danger },
  saveBtn: {
    backgroundColor: Accent,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  busy: { opacity: 0.6 },
  dataSection: { marginTop: Spacing.four },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  deleteRow: { alignItems: 'center', marginTop: Spacing.five },
  saveText: { color: AccentText, fontWeight: '700', fontSize: 16 },
});
