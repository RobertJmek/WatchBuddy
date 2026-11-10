import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol, type IconName } from '@/components/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  hapticFailure,
  hapticHold,
  hapticSuccess,
  hapticTick,
  hapticToggle,
} from '@/lib/haptics';
import { keys } from '@/lib/keys';
import { getFavorite, setFavorite } from '@/lib/library';
import type { TitleRef } from '@/lib/navigation';
import { titleQueryOptions } from '@/lib/tmdb';
import { logTitleWatch } from '@/lib/use-search-log';

/** How long a finger rests on a title before its menu opens. */
const HOLD_MS = 350;
const WIDTH = 248;
const HEADER_H = 40;
const ROW_H = 56;
const ROWS = 2;
const HEIGHT = HEADER_H + ROW_H * ROWS;
/** Clear of the fingertip, so the menu isn't under the hand that opened it. */
const FINGER_GAP = 28;
/** How far outside a row's sides the finger still counts as on it. */
const SIDE_SLOP = 24;
/** The chosen row stays lit this long before the menu leaves. */
const CONFIRM_MS = 160;

type Options = {
  /** The screen's own log (Search keeps its ✓ and swipe-left undo this way). */
  onLog?: () => void;
};

type Host = {
  open: (title: TitleRef, options: Options, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  release: () => void;
  cancel: () => void;
};

let host: Host | null = null;

/**
 * Wraps a poster or a title row. Hold it and the title's menu opens under the
 * finger; slide onto an option and let go to choose it, or let go anywhere
 * else to back out. One continuous touch — the finger never leaves the screen.
 *
 * The pan only activates after the hold, so a tap still reaches the child and
 * a scroll that starts sooner still wins.
 */
export function TitleHold({
  title,
  onLog,
  children,
}: { title: TitleRef; children: ReactNode } & Options) {
  // Rebuilt each render (the compiler memoizes it while `title` and `onLog`
  // hold still); GestureDetector re-attaches the callbacks, not the handler.
  const gesture = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(HOLD_MS)
    .onStart((e) => host?.open(title, { onLog }, e.absoluteX, e.absoluteY))
    .onUpdate((e) => host?.move(e.absoluteX, e.absoluteY))
    .onEnd((_e, success) => {
      if (success) host?.release();
    })
    // After a release this is a no-op; after a cancelled pan it closes.
    .onFinalize(() => host?.cancel());

  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}

type Open = { title: TitleRef; options: Options; left: number; top: number };

/** Mounted once in the root layout, above the navigator; `TitleHold` drives it. */
export function TitleMenuHost() {
  const queryClient = useQueryClient();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState<Open | null>(null);
  const [active, setActive] = useState(-1);

  // What the gesture callbacks read. They outlive a render, so they go through
  // refs rather than closing over state.
  const live = useRef({ menu, active, width, height, insets });
  useEffect(() => {
    live.current = { menu, active, width, height, insets };
  });

  useEffect(() => {
    let closing: ReturnType<typeof setTimeout> | undefined;

    const run = (index: number, { title, options }: Open) => {
      const { tmdbId, mediaType } = title;
      const refresh = (titleId: string) => {
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

      if (index === 0) {
        hapticSuccess();
        if (options.onLog) return options.onLog();
        logTitleWatch(tmdbId, mediaType).then(
          (rows) => refresh(rows.titleId),
          hapticFailure,
        );
        return;
      }

      (async () => {
        const { title: row } = await queryClient.fetchQuery(
          titleQueryOptions(tmdbId, mediaType),
        );
        const key = keys.favorite(row.id);
        const was = await queryClient.fetchQuery({
          queryKey: key,
          queryFn: () => getFavorite(row.id),
        });
        hapticToggle(!was);
        queryClient.setQueryData(key, !was); // optimistic
        try {
          await setFavorite(row.id, !was);
          refresh(row.id);
        } catch (e) {
          queryClient.setQueryData(key, was);
          throw e;
        }
      })().catch(hapticFailure);
    };

    host = {
      open(title, options, x, y) {
        clearTimeout(closing);
        const { width: w, height: h, insets: i } = live.current;
        const left = Math.min(
          Math.max(x - WIDTH / 2, Spacing.three),
          w - WIDTH - Spacing.three,
        );
        // Above the finger when there is room, below it otherwise.
        const above = y - FINGER_GAP - HEIGHT;
        const top =
          above >= i.top + Spacing.two
            ? above
            : Math.min(y + FINGER_GAP, h - i.bottom - HEIGHT - Spacing.two);
        hapticHold();
        setActive(-1);
        setMenu({ title, options, left, top });
      },
      move(x, y) {
        const { menu: m, active: was } = live.current;
        if (!m) return;
        const inside = x >= m.left - SIDE_SLOP && x <= m.left + WIDTH + SIDE_SLOP;
        const row = Math.floor((y - m.top - HEADER_H) / ROW_H);
        const next = inside && row >= 0 && row < ROWS ? row : -1;
        if (next === was) return;
        if (next >= 0) hapticTick();
        // Written at once: two moves can arrive before React re-renders.
        live.current.active = next;
        setActive(next);
      },
      release() {
        const { menu: m, active: index } = live.current;
        if (!m) return;
        if (index < 0) return setMenu(null);
        run(index, m);
        // The chosen row stays lit for a beat, then the menu leaves.
        closing = setTimeout(() => setMenu(null), CONFIRM_MS);
        live.current.menu = null;
      },
      cancel() {
        if (live.current.menu) setMenu(null);
      },
    };
    return () => {
      host = null;
      clearTimeout(closing);
    };
  }, [queryClient]);

  if (!menu) return null;
  return <Menu menu={menu} active={active} />;
}

function Menu({ menu, active }: { menu: Open; active: number }) {
  const c = useTheme();
  const { tmdbId, mediaType, name } = menu.title;

  // Both are usually warm by the time the hold fires: posters prefetch the
  // title on touch-down. Until then the heart row has a neutral label.
  const titleQ = useQuery(titleQueryOptions(tmdbId, mediaType));
  const titleId = titleQ.data?.title.id;
  const favQ = useQuery({
    queryKey: keys.favorite(titleId ?? ''),
    queryFn: () => getFavorite(titleId!),
    enabled: !!titleId,
  });

  const rows: { icon: IconName; label: string }[] = [
    {
      icon: 'plus',
      label: mediaType === 'tv' ? 'Log whole series' : 'Log watch',
    },
    {
      icon: 'heart',
      label:
        favQ.data === undefined
          ? 'Favorite'
          : favQ.data
            ? 'Remove from favorites'
            : 'Add to favorites',
    },
  ];

  return (
    // The finger that opened this is still down and owned by the gesture, so
    // nothing here takes touches.
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityViewIsModal>
      <Animated.View
        entering={FadeIn.duration(120)}
        exiting={FadeOut.duration(120)}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      />
      <Animated.View
        entering={ZoomIn.springify().damping(18).stiffness(320)}
        exiting={FadeOut.duration(120)}
        style={[
          styles.card,
          {
            left: menu.left,
            top: menu.top,
            backgroundColor: c.backgroundElement,
          },
        ]}>
        <View style={styles.header}>
          <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={1}>
            {name ?? 'Title'}
          </ThemedText>
        </View>
        {rows.map((row, i) => {
          const on = i === active;
          return (
            <View key={row.icon} style={[styles.row, on && styles.rowOn]}>
              <IconSymbol
                name={row.icon}
                size={20}
                tintColor={on ? AccentText : c.text}
              />
              <ThemedText
                type="label"
                style={on ? styles.labelOn : undefined}
                numberOfLines={1}>
                {row.label}
              </ThemedText>
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' },
  card: {
    position: 'absolute',
    width: WIDTH,
    height: HEIGHT,
    borderRadius: Spacing.three,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  header: {
    height: HEADER_H,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  rowOn: { backgroundColor: Accent },
  labelOn: { color: AccentText },
});
