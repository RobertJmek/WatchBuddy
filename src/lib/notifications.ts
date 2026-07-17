import { supabase } from '@/lib/supabase';
import { requireViewer } from '@/lib/viewer';

export type NotificationItem = {
  id: string;
  type: 'reply' | 'like';
  actorId: string;
  actorName: string;
  actorAvatarUrl: string | null;
  ratingId: string;
  /** Set when the reply targeted one of the viewer's replies (not the review). */
  replyToComment: boolean;
  title: string | null;
  likeCount: number;
  created_at: string;
  unread: boolean;
};

/** The viewer's notifications, newest first, with actor + title context. */
export async function getNotifications(): Promise<NotificationItem[]> {
  const uid = await requireViewer();
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, actor_id, rating_id, reply_id, like_count, created_at, read_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const actorIds = [...new Set(rows.map((r) => r.actor_id))];
  const ratingIds = [...new Set(rows.map((r) => r.rating_id))];
  const replyIds = rows.map((r) => r.reply_id).filter(Boolean);

  const [actorsRes, ratingsRes, repliesRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', actorIds),
    supabase.from('ratings').select('id, entity_id').in('id', ratingIds),
    replyIds.length
      ? supabase
          .from('review_replies')
          .select('id, parent_reply_id')
          .in('id', replyIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  if (actorsRes.error) throw actorsRes.error;
  if (ratingsRes.error) throw ratingsRes.error;
  if (repliesRes.error) throw repliesRes.error;

  const titleIds = [
    ...new Set((ratingsRes.data ?? []).map((r: any) => r.entity_id)),
  ];
  const { data: titles, error: titlesErr } = await supabase
    .from('titles')
    .select('id, title')
    .in('id', titleIds);
  if (titlesErr) throw titlesErr;

  const actorById = new Map<string, any>(
    (actorsRes.data ?? []).map((p: any) => [p.id, p]),
  );
  const entityByRating = new Map<string, string>(
    (ratingsRes.data ?? []).map((r: any) => [r.id, r.entity_id]),
  );
  const titleById = new Map<string, string>(
    (titles ?? []).map((t: any) => [t.id, t.title]),
  );
  const parentByReply = new Map<string, string | null>(
    ((repliesRes.data ?? []) as any[]).map((r) => [r.id, r.parent_reply_id]),
  );

  return rows.map((r) => {
    const actor = actorById.get(r.actor_id);
    const entityId = entityByRating.get(r.rating_id);
    return {
      id: r.id,
      type: r.type,
      actorId: r.actor_id,
      actorName:
        actor?.display_name?.trim() ||
        (actor?.username ? `@${actor.username}` : 'Someone'),
      actorAvatarUrl: actor?.avatar_url ?? null,
      ratingId: r.rating_id,
      replyToComment: !!(r.reply_id && parentByReply.get(r.reply_id)),
      title: entityId ? (titleById.get(entityId) ?? null) : null,
      likeCount: r.like_count,
      created_at: r.created_at,
      unread: r.read_at == null,
    };
  });
}

export async function getUnreadCount(): Promise<number> {
  const uid = await requireViewer();
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function markAllRead() {
  const uid = await requireViewer();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', uid)
    .is('read_at', null);
  if (error) throw error;
}

/**
 * Live updates: any change to the viewer's notifications fires `onChange`.
 * Returns an unsubscribe function.
 */
export function subscribeToNotifications(uid: string, onChange: () => void) {
  const channel = supabase
    .channel(`notifications:${uid}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${uid}`,
      },
      onChange,
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
