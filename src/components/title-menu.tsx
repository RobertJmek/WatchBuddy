import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useActionMenu } from '@/components/action-menu';
import { hapticFailure, hapticHold, hapticSuccess, hapticToggle } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import { getFavorite, setFavorite } from '@/lib/library';
import type { TitleRef } from '@/lib/navigation';
import { titleQueryOptions } from '@/lib/tmdb';
import { logTitleWatch } from '@/lib/use-search-log';

type Options = {
  /** The screen's own log (Search keeps its ✓ and swipe-left undo this way). */
  onLog?: () => void;
};

let present: ((title: TitleRef, options?: Options) => void) | null = null;

/**
 * The hold menu of a title, from any poster or title row: log it, or flip its
 * favorite. Buzzes at once, so the hold answers before the menu is up.
 */
export function openTitleMenu(title: TitleRef, options?: Options) {
  hapticHold();
  present?.(title, options);
}

/** Mounted once in the root layout; `openTitleMenu` talks to it. */
export function TitleMenuHost() {
  const queryClient = useQueryClient();
  const { open, menu } = useActionMenu();

  useEffect(() => {
    present = async ({ tmdbId, mediaType, name }, options) => {
      let titleId: string;
      let favorite: boolean;
      try {
        // Usually warm: posters prefetch the title while the finger is down.
        const { title } = await queryClient.fetchQuery(titleQueryOptions(tmdbId, mediaType));
        titleId = title.id;
        favorite = await queryClient.fetchQuery({
          queryKey: keys.favorite(titleId),
          queryFn: () => getFavorite(titleId),
        });
      } catch {
        hapticFailure();
        return;
      }

      const invalidate = () => {
        for (const queryKey of [
          keys.diary(),
          keys.stats(),
          keys.library(),
          keys.libraryStatus(titleId),
          keys.seriesPasses(titleId),
          keys.movieWatches(titleId),
        ]) {
          queryClient.invalidateQueries({ queryKey });
        }
      };

      open(
        [
          {
            label: mediaType === 'tv' ? 'Log whole series' : 'Log watch',
            run: () => {
              hapticSuccess();
              if (options?.onLog) return options.onLog();
              logTitleWatch(tmdbId, mediaType).then(invalidate, hapticFailure);
            },
          },
          {
            label: favorite ? 'Remove from favorites' : 'Add to favorites',
            run: () => {
              hapticToggle(!favorite);
              queryClient.setQueryData(keys.favorite(titleId), !favorite); // optimistic
              setFavorite(titleId, !favorite).then(invalidate, () => {
                queryClient.setQueryData(keys.favorite(titleId), favorite);
                hapticFailure();
              });
            },
          },
        ],
        name ?? undefined,
      );
    };
    return () => {
      present = null;
    };
  }, [open, queryClient]);

  return menu;
}
