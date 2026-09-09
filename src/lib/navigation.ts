import type { useRouter } from 'expo-router';

import type { MediaType } from '@/lib/tmdb';

type Router = ReturnType<typeof useRouter>;

/**
 * Everything a screen needs to open a title. The catalog spells this triple
 * three different ways (`tmdb_id`/`media_type`/`title` on a poster,
 * `tmdbId`/`mediaType`/`titleName` on a diary or feed row), so callers name the
 * three fields and this module owns the route.
 */
export type TitleRef = {
  tmdbId: number;
  mediaType: MediaType;
  /** Shown in the header while the title screen loads; optional, not the key. */
  name?: string | null;
};

/**
 * Push the title screen. The route name, the param names and the id's coercion
 * to a string live here and nowhere else — every screen with a poster on it
 * used to carry its own copy.
 */
export function openTitle(router: Router, { tmdbId, mediaType, name }: TitleRef) {
  router.push({
    pathname: '/title/[id]',
    params: { id: String(tmdbId), type: mediaType, name: name ?? undefined },
  });
}
