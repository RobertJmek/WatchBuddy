import { useQuery, useQueryClient } from '@tanstack/react-query';
import { requireOptionalNativeModule } from 'expo';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol, type IconName } from '@/components/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, PlaceholderBg, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
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
import { imageUrl, titleQueryOptions } from '@/lib/tmdb';
import { logTitleWatch } from '@/lib/use-search-log';

/** How long a finger rests on a title before it lifts. */
const HOLD_MS = 350;
/** The lifted poster. */
const POSTER_W = 180;
const POSTER_H = 270;
const MENU_W = 264;
const ROW_H = 52;
/** The menu's own padding: rows sit inset, so the lit one reads as a pill. */
const MENU_PAD = 6;
/** Rows the menu has from the moment it opens: `useActions` always returns these. */
const ROWS = 2;
const GAP = 12;
/**
 * A binary built before expo-blur was added has no blur view, and rendering
 * one there is a red screen. Those builds get a plain dim instead.
 */
const CAN_BLUR = requireOptionalNativeModule('ExpoBlur') != null;
const EDGE = Spacing.three;
/** How far outside the menu's sides the finger still counts as on a row. */
const SIDE_SLOP = 24;
/** The chosen row stays lit this long before everything settles back. */
const CONFIRM_MS = 140;
const CLOSE_MS = 180;

type Rect = { x: number; y: number; width: number; height: number };

/** What a held title needs: where it goes, and the poster that lifts. */
type HeldTitle = TitleRef & { posterPath: string | null };

type Options = {
  /** The screen's own log (Search keeps its ✓ and swipe-left undo this way). */
  onLog?: () => void;
};

/**
 * One row of the hold menu. To add an option, add an entry in `useActions`
 * (and count it in `ROWS`): the menu sizes itself and hit-tests from the list.
 */
type Action = { key: string; icon: IconName; label: string; run: () => void };

type Host = {
  open: (title: HeldTitle, options: Options, source: Rect) => void;
  move: (x: number, y: number) => void;
  /** The finger left the screen: choose the lit row, or settle back. */
  end: () => void;
};

let host: Host | null = null;

// The gesture's callbacks go through these and never name `host` themselves:
// a gesture callback keeps the values it closed over when it was created, and
// a poster in a memoized list is created before the host has mounted.
function holdStart(box: View | null, title: HeldTitle, options: Options) {
  box?.measureInWindow((x, y, width, height) =>
    host?.open(title, options, { x, y, width, height }),
  );
}
function holdMove(x: number, y: number) {
  host?.move(x, y);
}
function holdEnd() {
  host?.end();
}

/**
 * Wraps a poster or a title row. Hold it and the poster lifts out of a blurred
 * page with its menu underneath; slide onto an option and let go to choose it,
 * or let go anywhere else to settle back. One continuous touch.
 *
 * The pan only activates after the hold, so a tap still reaches the child and
 * a scroll that starts sooner still wins.
 */
export function TitleHold({
  title,
  onLog,
  children,
}: { title: HeldTitle; children: ReactNode } & Options) {
  const box = useRef<View>(null);

  // Rebuilt each render (the compiler memoizes it while the props hold still);
  // GestureDetector re-attaches the callbacks, not the native handler.
  /* eslint-disable react-hooks/refs -- the ref is read when the hold fires,
     in a gesture callback, never while rendering. */
  const gesture = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(HOLD_MS)
    .onStart(() => holdStart(box.current, title, { onLog }))
    .onUpdate((e) => holdMove(e.absoluteX, e.absoluteY))
    // Ended or cancelled, the finger is gone either way.
    .onFinalize(() => holdEnd());
  /* eslint-enable react-hooks/refs */

  return (
    <GestureDetector gesture={gesture}>
      <View ref={box} collapsable={false}>
        {children}
      </View>
    </GestureDetector>
  );
}

/** Everything the open menu is made of, laid out once when the hold fires. */
type Open = {
  title: HeldTitle;
  options: Options;
  /** Where the lift starts from: the poster the finger is on. */
  from: Rect;
  poster: { left: number; top: number };
  menu: { left: number; top: number };
};

/** The menu's rows for a title. Add an option here. */
function useActions(open: Open | null): Action[] {
  const queryClient = useQueryClient();
  // Both are usually warm by the time the hold fires: posters prefetch the
  // title on touch-down. Until then the heart row has a neutral label.
  const titleQ = useQuery({
    ...titleQueryOptions(open?.title.tmdbId ?? 0, open?.title.mediaType ?? 'movie'),
    enabled: !!open,
  });
  const titleId = open ? titleQ.data?.title.id : undefined;
  const favQ = useQuery({
    queryKey: keys.favorite(titleId ?? ''),
    queryFn: () => getFavorite(titleId!),
    enabled: !!titleId,
  });
  if (!open) return [];

  const { tmdbId, mediaType } = open.title;
  const refresh = (id: string) => {
    for (const queryKey of [
      keys.diary(),
      keys.stats(),
      keys.library(),
      keys.libraryStatus(id),
      keys.seriesPasses(id),
      keys.movieWatches(id),
    ]) {
      queryClient.invalidateQueries({ queryKey });
    }
  };

  return [
    {
      key: 'log',
      icon: 'plus',
      label: mediaType === 'tv' ? 'Log whole series' : 'Log watch',
      run: () => {
        hapticSuccess();
        if (open.options.onLog) return open.options.onLog();
        logTitleWatch(tmdbId, mediaType).then(
          (rows) => refresh(rows.titleId),
          hapticFailure,
        );
      },
    },
    {
      key: 'favorite',
      icon: 'heart',
      label:
        favQ.data === undefined
          ? 'Favorite'
          : favQ.data
            ? 'Remove from favorites'
            : 'Add to favorites',
      run: () => {
        (async () => {
          const { title } = await queryClient.fetchQuery(
            titleQueryOptions(tmdbId, mediaType),
          );
          const key = keys.favorite(title.id);
          const was = await queryClient.fetchQuery({
            queryKey: key,
            queryFn: () => getFavorite(title.id),
          });
          hapticToggle(!was);
          queryClient.setQueryData(key, !was); // optimistic
          try {
            await setFavorite(title.id, !was);
            refresh(title.id);
          } catch (e) {
            queryClient.setQueryData(key, was);
            throw e;
          }
        })().catch(hapticFailure);
      },
    },
  ];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Mounted once in the root layout, above the navigator; `TitleHold` drives it. */
export function TitleMenuHost() {
  const c = useTheme();
  const scheme = useColorScheme();
  const tint = scheme === 'dark' ? 'dark' : 'light';
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<Open | null>(null);
  const [active, setActive] = useState(-1);
  const actions = useActions(open);
  /** 0 = on the page, 1 = lifted. Drives every animated layer. */
  const lift = useSharedValue(0);

  // What the gesture callbacks read. They outlive a render, so they go through
  // a ref rather than closing over state.
  const live = useRef({ open, active, actions, width, height, insets });
  useEffect(() => {
    live.current = { open, active, actions, width, height, insets };
  });

  useEffect(() => {
    let closing: ReturnType<typeof setTimeout> | undefined;

    host = {
      open(title, options, source) {
        clearTimeout(closing);
        const { width: w, height: h, insets: i } = live.current;
        // A row is wider than tall; its poster is the thumb at its left edge.
        const from: Rect =
          source.width > source.height
            ? {
                x: source.x + Spacing.two,
                y: source.y + Spacing.two,
                width: ((source.height - Spacing.three) * 2) / 3,
                height: source.height - Spacing.three,
              }
            : source;
        const left = clamp(
          from.x + from.width / 2 - POSTER_W / 2,
          EDGE,
          w - EDGE - POSTER_W,
        );
        const top = clamp(
          from.y + from.height / 2 - POSTER_H / 2,
          i.top + EDGE,
          h - i.bottom - EDGE - ROW_H * ROWS - MENU_PAD * 2 - GAP - POSTER_H,
        );
        // Under the poster, sharing its edge on the side it sits on.
        const menuLeft = left + POSTER_W / 2 < w / 2 ? left : left + POSTER_W - MENU_W;
        const next: Open = {
          title,
          options,
          from,
          poster: { left, top },
          menu: {
            left: clamp(menuLeft, EDGE, w - EDGE - MENU_W),
            top: top + POSTER_H + GAP,
          },
        };
        hapticHold();
        live.current.open = next; // moves can arrive before React re-renders
        live.current.active = -1;
        setActive(-1);
        setOpen(next);
        lift.value = 0;
        lift.value = withSpring(1, { damping: 22, stiffness: 260 });
      },
      move(x, y) {
        const { open: o, active: was } = live.current;
        if (!o) return;
        const inside =
          x >= o.menu.left - SIDE_SLOP && x <= o.menu.left + MENU_W + SIDE_SLOP;
        const row = Math.floor((y - o.menu.top - MENU_PAD) / ROW_H);
        const next = inside && row >= 0 && row < ROWS ? row : -1;
        if (next === was) return;
        if (next >= 0) hapticTick();
        live.current.active = next;
        setActive(next);
      },
      end() {
        const { open: o, active: index, actions: rows } = live.current;
        if (!o) return;
        live.current.open = null; // no more moves, no second end
        const chosen = rows[index];
        chosen?.run();
        // A chosen row stays lit for a beat, then everything settles back.
        closing = setTimeout(
          () => {
            lift.value = withTiming(0, { duration: CLOSE_MS });
            closing = setTimeout(() => setOpen(null), CLOSE_MS);
          },
          chosen ? CONFIRM_MS : 0,
        );
      },
    };
    return () => {
      host = null;
      clearTimeout(closing);
    };
  }, [lift]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: lift.value }));
  const posterStyle = useAnimatedStyle(() => {
    if (!open) return {};
    const { from, poster } = open;
    // From the poster under the finger to the lifted one, about its centre.
    const dx = from.x + from.width / 2 - (poster.left + POSTER_W / 2);
    const dy = from.y + from.height / 2 - (poster.top + POSTER_H / 2);
    return {
      opacity: interpolate(lift.value, [0, 0.15], [0, 1], 'clamp'),
      transform: [
        { translateX: interpolate(lift.value, [0, 1], [dx, 0]) },
        { translateY: interpolate(lift.value, [0, 1], [dy, 0]) },
        { scale: interpolate(lift.value, [0, 1], [from.width / POSTER_W, 1]) },
      ],
    };
  });
  const menuStyle = useAnimatedStyle(() => ({
    opacity: lift.value,
    transform: [
      { translateY: interpolate(lift.value, [0, 1], [-GAP, 0]) },
      { scale: interpolate(lift.value, [0, 1], [0.94, 1]) },
    ],
  }));

  if (!open) return null;
  return (
    // The finger that opened this is still down and owned by the gesture, so
    // nothing here takes touches.
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        {CAN_BLUR && (
          <BlurView style={StyleSheet.absoluteFill} intensity={50} tint={tint} />
        )}
        <View style={[StyleSheet.absoluteFill, CAN_BLUR ? styles.dim : styles.dimOnly]} />
      </Animated.View>

      <Animated.View
        style={[
          styles.poster,
          { left: open.poster.left, top: open.poster.top },
          posterStyle,
        ]}>
        <Image
          style={styles.posterImage}
          source={{ uri: imageUrl(open.title.posterPath, 'w342') ?? undefined }}
          contentFit="cover"
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.menu,
          { left: open.menu.left, top: open.menu.top },
          !CAN_BLUR && { backgroundColor: c.backgroundElement },
          menuStyle,
        ]}>
        {/* The menu is a sheet of material, like the system's own. */}
        {CAN_BLUR && (
          <BlurView
            style={StyleSheet.absoluteFill}
            intensity={90}
            tint={
              scheme === 'dark' ? 'systemThickMaterialDark' : 'systemThickMaterialLight'
            }
          />
        )}
        {actions.map((action, i) => {
          const on = i === active;
          // The lit row is a teal fill: a finger covers most of it, so the
          // edge that shows has to be unmistakable.
          const ink = on ? AccentText : c.text;
          return (
            <View
              key={action.key}
              style={[styles.row, on && { backgroundColor: Accent }]}>
              <IconSymbol name={action.icon} size={20} tintColor={ink} />
              <ThemedText type="label" style={{ color: ink }} numberOfLines={1}>
                {action.label}
              </ThemedText>
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(0,0,0,0.35)' },
  dimOnly: { backgroundColor: 'rgba(0,0,0,0.6)' },
  poster: {
    position: 'absolute',
    width: POSTER_W,
    height: POSTER_H,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  posterImage: { flex: 1, borderRadius: 16, backgroundColor: PlaceholderBg },
  menu: {
    position: 'absolute',
    width: MENU_W,
    padding: MENU_PAD,
    borderRadius: 20,
    overflow: 'hidden',
  },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: 14,
  },
});
