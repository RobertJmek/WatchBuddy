import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import { supabase } from '@/lib/supabase';
import { currentViewer, requireViewer, updateMine } from '@/lib/viewer';

export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
};

export type ProfileUpdate = {
  display_name: string | null;
  username: string | null;
  bio: string | null;
  avatar_url?: string | null;
};

/** Thrown when a username update collides with the unique constraint. */
/** A username the app accepts: 3–20 chars, a–z / 0–9 / _. */
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** The error to show for a non-empty, invalid username, or null when it's fine. */
export function usernameError(handle: string): string | null {
  return handle && !USERNAME_RE.test(handle)
    ? 'Username must be 3–20 characters: a–z, 0–9 or _.'
    : null;
}

/** An image the user picked but hasn't uploaded yet. */
export type PickedImage = { uri: string; mimeType?: string };

/** Let the user pick a square avatar from their library; null if they don't. */
export async function pickAvatarImage(): Promise<PickedImage | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Photo access is needed to choose a picture.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, mimeType: asset.mimeType ?? undefined };
}

class UsernameTakenError extends Error {
  constructor() {
    super('That username is already taken.');
    this.name = 'UsernameTakenError';
  }
}

/** The signed-in user's profile row (created by the new-user trigger). */
export async function getMyProfile(): Promise<Profile | null> {
  const uid = await currentViewer();
  if (!uid) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, bio')
    .eq('id', uid)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile) ?? null;
}

/** Any user's public profile by id (profiles are world-readable). */
export async function getProfileById(id: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, bio')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile) ?? null;
}

/**
 * Upload a picked image to the user's avatar folder and return its public URL
 * (cache-busted so the new image shows immediately after an overwrite).
 */
async function uploadAvatar(
  uri: string,
  mimeType?: string | null,
): Promise<string> {
  const uid = await requireViewer();

  const contentType = mimeType ?? 'image/jpeg';
  const ext = contentType.split('/')[1]?.split('+')[0] || 'jpg';
  const path = `${uid}/avatar.${ext}`;

  const arrayBuffer = await fetch(uri).then((res) => res.arrayBuffer());

  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, arrayBuffer, { contentType, upsert: true });
  if (error) throw error;

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

/** Update the signed-in user's profile. */
async function updateProfile(update: ProfileUpdate): Promise<void> {
  // `profiles` is owned by its primary key, not a `user_id` column.
  const { q } = await updateMine('profiles', update, 'id');

  const { error } = await q;
  if (error) {
    // 23505 = unique_violation, i.e. the username is taken.
    if (error.code === '23505') throw new UsernameTakenError();
    throw error;
  }
}

/**
 * Save the profile form: upload the picked avatar (if any), then write the
 * fields. Throws `UsernameTakenError` when the username is someone else's.
 */
export async function saveProfile(
  fields: Omit<ProfileUpdate, 'avatar_url'>,
  picked: PickedImage | null,
): Promise<void> {
  const avatar_url = picked ? await uploadAvatar(picked.uri, picked.mimeType) : undefined;
  await updateProfile({ ...fields, ...(avatar_url ? { avatar_url } : {}) });
}

/** User-facing text for a failed `saveProfile`. */
export function saveProfileErrorMessage(e: unknown): string {
  return e instanceof UsernameTakenError ? e.message : 'Could not save. Try again.';
}
