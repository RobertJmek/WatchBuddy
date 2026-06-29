import { supabase } from '@/lib/supabase';
import { currentViewer, requireViewer } from '@/lib/viewer';

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
export class UsernameTakenError extends Error {
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
export async function uploadAvatar(
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

/** Update the signed-in user's profile (RLS restricts this to their own row). */
export async function updateProfile(update: ProfileUpdate): Promise<void> {
  const uid = await requireViewer();

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', uid);
  if (error) {
    // 23505 = unique_violation, i.e. the username is taken.
    if (error.code === '23505') throw new UsernameTakenError();
    throw error;
  }
}
