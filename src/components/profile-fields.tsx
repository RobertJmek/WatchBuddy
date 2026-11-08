import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { IconSymbol } from '@/components/icon-symbol';
import { Step } from '@/components/step';
import { ThemedText } from '@/components/themed-text';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PROFILE_LIMITS } from '@/lib/profile';

/**
 * Photo, username, name and bio as card-style Steps. Shared by the first-run
 * profile step and Edit Profile (ADR 0030), which own the state and the save.
 */
export function ProfileFields({
  avatarUri,
  username,
  displayName,
  bio,
  onUsername,
  onDisplayName,
  onBio,
  onPickAvatar,
  saving,
  error,
}: {
  avatarUri: string | null;
  username: string;
  displayName: string;
  bio: string;
  onUsername: (v: string) => void;
  onDisplayName: (v: string) => void;
  onBio: (v: string) => void;
  onPickAvatar: () => void;
  saving: boolean;
  error: string | null;
}) {
  const c = useTheme();
  const field = [styles.field, { backgroundColor: c.backgroundElement }];
  return (
    <>
      <Step label="Photo">
        <Pressable
          style={styles.photoRow}
          onPress={onPickAvatar}
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
            onChangeText={onUsername}
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
            onChangeText={onDisplayName}
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
            onChangeText={onBio}
            accessibilityLabel="Bio"
          />
        </View>
      </Step>

      {error && (
        <ThemedText themeColor="danger" accessibilityLiveRegion="polite">
          {error}
        </ThemedText>
      )}
    </>
  );
}

/** The bio box's minimum height; screens clear it when scrolling to the caret. */
export const BIO_MIN_HEIGHT = 88;

const styles = StyleSheet.create({
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
  bio: { minHeight: BIO_MIN_HEIGHT, textAlignVertical: 'top' },
});
