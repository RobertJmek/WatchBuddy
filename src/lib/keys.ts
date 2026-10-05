import type { MediaType } from '@/lib/tmdb';

/**
 * Every TanStack Query key in the app, in one place.
 *
 * The rule that makes this worth having: **a resource has exactly one root**,
 * and whose copy it is goes in the suffix. TanStack matches keys by prefix by
 * default, so `invalidateQueries({ queryKey: keys.stats() })` reaches your own
 * stats *and* everyone else's that happen to be loaded.
 *
 * That was the bug this file fixes. Your statistics lived under `['stats']` but
 * the same numbers on a profile screen lived under `['userStats', id]` — two
 * different roots, which prefix matching cannot bridge. `user/[id]` knows it
 * may be showing *you* (`isMe`) and read the `user*` keys anyway, so logging a
 * watch while your own profile was open left that screen stale: every mutation
 * in the app invalidates `['stats']`, `['library']` and `['diary']`, and none of
 * them touched `['userStats', <you>]`.
 *
 * `lib/tmdb.ts` keeps its own `['title', …]` key — it is the read-through cache
 * for the shared catalog, and it was already the model for this.
 */
export const keys = {
  // --- a person's own data; bare = the signed-in viewer -------------------
  /** @param userId someone else's profile; omit for your own. */
  stats: (userId?: string) => (userId ? (['stats', userId] as const) : (['stats'] as const)),
  library: (userId?: string) =>
    userId ? (['library', userId] as const) : (['library'] as const),
  diary: (userId?: string) => (userId ? (['diary', userId] as const) : (['diary'] as const)),
  profile: (userId?: string) =>
    userId ? (['profile', userId] as const) : (['profile'] as const),

  // --- social ------------------------------------------------------------
  /** Bare invalidates both your counts and whoever's profile is open. */
  followCounts: (userId?: string) =>
    userId ? (['followCounts', userId] as const) : (['followCounts'] as const),
  /** Whether *you* follow `userId`. Bare = every user's (for bulk invalidation). */
  follow: (userId?: string) =>
    userId ? (['follow', userId] as const) : (['follow'] as const),
  followers: (userId?: string) =>
    userId ? (['followers', userId] as const) : (['followers'] as const),
  following: (userId?: string) =>
    userId ? (['following', userId] as const) : (['following'] as const),

  // --- feed & notifications ----------------------------------------------
  feed: () => ['feed'] as const,
  notifications: () => ['notifications'] as const,
  notifUnread: () => ['notifUnread'] as const,

  // --- reviews -----------------------------------------------------------
  /** Community reviews of a title. Bare invalidates every title's. */
  titleRatings: (titleId?: string) =>
    titleId ? (['titleRatings', titleId] as const) : (['titleRatings'] as const),
  reviewThread: (ratingId?: string) =>
    ratingId ? (['reviewThread', ratingId] as const) : (['reviewThread'] as const),
  reviewLikers: (ratingId?: string) =>
    ratingId ? (['reviewLikers', ratingId] as const) : (['reviewLikers'] as const),

  // --- moderation ---------------------------------------------------------
  /**
   * Everything about blocks under one root: bare invalidates the list of people
   * you blocked and every profile's block status at once.
   */
  blocked: () => ['blocked'] as const,
  blockedUsers: () => ['blocked', 'users'] as const,
  /** Whether `userId` is blocked by you, hidden from you, or neither. */
  blockStatus: (userId: string) => ['blocked', 'status', userId] as const,

  /**
   * Your own score + review of a title. The rating bar reads it and the review
   * thread invalidates it, so an edit or delete there can't be undone by a
   * stale copy on the title screen underneath. Bare = every title's.
   */
  myRating: (titleId?: string) =>
    titleId ? (['myRating', titleId] as const) : (['myRating'] as const),

  // --- catalog & search ---------------------------------------------------
  libraryStatus: (titleId: string) => ['libraryStatus', titleId] as const,
  /** Whether a title is favorited in your library. */
  favorite: (titleId: string) => ['favorite', titleId] as const,
  /** Your own watches of one movie (the title screen's "Watched N×"). */
  movieWatches: (titleId: string) => ['movieWatches', titleId] as const,
  genres: () => ['genres'] as const,
  search: (term: string) => ['search', term] as const,
  userSearch: (term?: string) =>
    term !== undefined ? (['userSearch', term] as const) : (['userSearch'] as const),
  trending: () => ['trending'] as const,
  /**
   * ⚠️ The `1` is a **payload-shape version, not a page number**. It exists to
   * orphan the malformed pages a pre-pagination proxy wrote into the persisted
   * cache in v1.16.0 — bump it if the shape changes again, never for paging.
   */
  trendingPage: (mediaType: MediaType) => ['trendingPage', 1, mediaType] as const,
};
