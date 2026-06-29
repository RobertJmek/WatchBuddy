import { supabase } from '@/lib/supabase';
import { requireViewer } from '@/lib/viewer';

/** A person as shown in search results and follower/following lists. */
export type UserResult = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  /** Whether the signed-in viewer currently follows this user. */
  is_following: boolean;
};

export type FollowCounts = { followers: number; following: number };

/**
 * Annotate profile rows with whether the viewer follows each one, via a single
 * follows lookup scoped to the result ids.
 */
async function annotateFollowing(
  viewerId: string,
  rows: Omit<UserResult, 'is_following'>[],
): Promise<UserResult[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const { data, error } = await supabase
    .from('follows')
    .select('followee_id')
    .eq('follower_id', viewerId)
    .in('followee_id', ids);
  if (error) throw error;
  const following = new Set((data ?? []).map((r: any) => r.followee_id));
  return rows.map((r) => ({ ...r, is_following: following.has(r.id) }));
}

/** Fetch profiles by id (preserving nothing about order) and annotate follow state. */
async function fetchProfiles(
  viewerId: string,
  ids: string[],
): Promise<UserResult[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', ids);
  if (error) throw error;
  return annotateFollowing(viewerId, (data ?? []) as any[]);
}

/**
 * Search people by case-insensitive prefix on username OR display_name,
 * excluding the signed-in user. Wildcard/`or` metacharacters are stripped so
 * the typed text can't change the query shape.
 */
export async function searchUsers(query: string): Promise<UserResult[]> {
  const viewerId = await requireViewer();
  const term = query.trim().replace(/[%_,()]/g, '');
  if (term.length === 0) return [];
  const pattern = `${term}%`;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
    .neq('id', viewerId)
    .limit(20);
  if (error) throw error;
  return annotateFollowing(viewerId, (data ?? []) as any[]);
}

/** Follow a user. No-ops if the edge already exists (unique violation ignored). */
export async function follow(userId: string): Promise<void> {
  const viewerId = await requireViewer();
  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: viewerId, followee_id: userId });
  if (error && error.code !== '23505') throw error;
}

/** Unfollow a user (removes the viewer's edge; no-ops if absent). */
export async function unfollow(userId: string): Promise<void> {
  const viewerId = await requireViewer();
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', viewerId)
    .eq('followee_id', userId);
  if (error) throw error;
}

/** Whether the signed-in viewer follows the given user. */
export async function getFollowState(userId: string): Promise<boolean> {
  const viewerId = await requireViewer();
  const { count, error } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('follower_id', viewerId)
    .eq('followee_id', userId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** Follower and following counts for a user. */
export async function getFollowCounts(userId: string): Promise<FollowCounts> {
  const [followers, following] = await Promise.all([
    supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('followee_id', userId),
    supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', userId),
  ]);
  if (followers.error) throw followers.error;
  if (following.error) throw following.error;
  return { followers: followers.count ?? 0, following: following.count ?? 0 };
}

/** People who follow the given user. */
export async function getFollowers(userId: string): Promise<UserResult[]> {
  const viewerId = await requireViewer();
  const { data, error } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('followee_id', userId);
  if (error) throw error;
  const ids = (data ?? []).map((r: any) => r.follower_id);
  return fetchProfiles(viewerId, ids);
}

/** People the given user follows. */
export async function getFollowing(userId: string): Promise<UserResult[]> {
  const viewerId = await requireViewer();
  const { data, error } = await supabase
    .from('follows')
    .select('followee_id')
    .eq('follower_id', userId);
  if (error) throw error;
  const ids = (data ?? []).map((r: any) => r.followee_id);
  return fetchProfiles(viewerId, ids);
}
