import { useQuery, useQueryClient } from '@tanstack/react-query';
import { requireOptionalNativeModule } from 'expo';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol, type IconName } from '@/components/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { seriesPassesOptions, type Passes } from '@/components/tv-watch-bar';
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
import {
  getFavorite,
  getLibraryStatus,
  LIBRARY_STATUSES,
  removeFromLibrary,
  setFavorite,
  setLibraryStatus,
  type LibraryStatus,
  type MyLibraryEntry,
} from '@/lib/library';
import { openTitle, type TitleRef } from '@/lib/navigation';
import { imageUrl, titleQueryOptions } from '@/lib/tmdb';
import { logTitleWatch } from '@/lib/use-search-log';
import { ensureWatched, getMovieWatches, type MovieWatch } from '@/lib/watches';

/** How long a finger rests on a title before it lifts. */
const HOLD_MS = 350;
/** The lifted poster. */
const POSTER_W = 128;
const POSTER_H = 192;
const MENU_W = 296;
const ROW_H = 52;
/** The menu's own padding: rows sit inset, so the lit one reads as a pill. */
const MENU_PAD = 6;
const GAP = 12;
/** Rows the menu has from the moment it opens: `useActions` always returns these. */
const ROWS = 5;
/** The second block: every Library status but Watchlist (that one is a row), side by side. */
const STATUSES = LIBRARY_STATUSES.filter((x) => x.value !== 'watchlist');
const STATUS_H = 44;
const BLOCK_GAP = 8;
const MENU_H = ROW_H * ROWS + MENU_PAD * 2;
const STATUS_TOP = MENU_H + BLOCK_GAP;
const STATUS_BLOCK_H = STATUS_H + MENU_PAD * 2;
const CELL_W = (MENU_W - MENU_PAD * 2) / STATUSES.length;
/** Poster, menu and status row, stacked. */
const STACK_H = POSTER_H + GAP + STATUS_TOP + STATUS_H + MENU_PAD * 2;
/**
 * A binary built before expo-blur was added has no blur view, and rendering
 * one there is a red screen. Those builds get a plain dim instead.
 */
const CAN_BLUR = requireOptionalNativeModule('ExpoBlur') != null;
const EDGE = Spacing.three;
/** How far outside the menu's sides the finger still counts as on a row. */
const SIDE_SLOP = 24;
/**
 * The finger has to travel this far before any row can light. The menu may open
 * under the finger, and letting go without moving must never choose anything.
 */
const ARM_DISTANCE = 24;
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
 * One choice in the hold menu. To add a row, add an entry in `useActions`
 * before the statuses (and count it in `ROWS`): the menu sizes itself and
 * hit-tests from the list. The status cells come last and carry no icon.
 */
type Action = {
  key: string;
  icon?: IconName;
  label: string;
  /** Small text at the row's far end (how often the title was watched). */
  detail?: string;
  /** A status cell: this is the title's status right now. */
  current?: boolean;
  run: () => void;
};

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
  /**
   * `above`: the menu sits over the poster and reads bottom-up, so its first
   * row is still the one nearest the poster and the finger.
   */
  menu: { left: number; top: number; above: boolean };
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
  const statusQ = useQuery({
    queryKey: keys.libraryStatus(titleId ?? ''),
    queryFn: () => getLibraryStatus(titleId!),
    enabled: !!titleId,
  });
  const isMovie = open?.title.mediaType === 'movie';
  // The movie watch bar's own query, so a log from either shows in both.
  const watchesQ = useQuery({
    queryKey: keys.movieWatches(titleId ?? ''),
    queryFn: () => getMovieWatches(titleId!),
    enabled: !!titleId && isMovie,
  });
  const passesQ = useQuery({
    ...seriesPassesOptions(
      titleId ?? '',
      open?.title.tmdbId ?? 0,
      titleQ.data?.seasons ?? [],
    ),
    enabled: !!titleId && !isMovie && (titleQ.data?.seasons.length ?? 0) > 0,
  });
  const router = useRouter();
  if (!open) return [];
  const watched = isMovie ? watchesQ.data?.length : passesQ.data?.passes;

  const { tmdbId, mediaType, name } = open.title;
  /**
   * Puts the title in `next` (null takes it out of the Library), optimistically.
   * Completed means watched (ADR 0024), as on the title page.
   */
  const setStatus = (pick: (was: LibraryStatus | null) => LibraryStatus | null) => {
    (async () => {
      const { title } = await queryClient.fetchQuery(
        titleQueryOptions(tmdbId, mediaType),
      );
      const key = keys.libraryStatus(title.id);
      const was = await queryClient.fetchQuery({
        queryKey: key,
        queryFn: () => getLibraryStatus(title.id),
      });
      const next = pick(was);
      if (next === was) return;
      hapticToggle(next !== null);
      queryClient.setQueryData(key, next); // optimistic
      try {
        if (next === null) await removeFromLibrary(title.id);
        else await setLibraryStatus(title.id, next);
        if (next === 'completed')
          await ensureWatched(
            { id: title.id, tmdbId, mediaType },
            { onlyIfUntouched: false },
          );
        refresh(title.id);
        queryClient.invalidateQueries({ queryKey: keys.favorite(title.id) });
      } catch (e) {
        queryClient.setQueryData(key, was);
        throw e;
      }
    })().catch(hapticFailure);
  };
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
      detail: watched ? `×${watched}` : undefined,
      run: () => {
        hapticSuccess();
        // A whole series takes seconds to write. Everything on screen that
        // the log changes moves now; `refresh` then replaces it with the truth,
        // which on a failure is the state before.
        if (titleId) {
          const at = new Date().toISOString();
          queryClient.setQueryData(keys.libraryStatus(titleId), 'completed');
          queryClient.setQueryData<MyLibraryEntry[]>(keys.library(), (list) =>
            list?.map((e) =>
              e.title?.id === titleId ? { ...e, status: 'completed' } : e,
            ),
          );
          // Not through Search's own log: it never refreshes this key, and the
          // placeholder row would outlive the write.
          if (isMovie && !open.options.onLog)
            queryClient.setQueryData<MovieWatch[]>(keys.movieWatches(titleId), (w) => [
              { id: `pending-${at}`, watched_at: at },
              ...(w ?? []),
            ]);
          else if (!isMovie)
            queryClient.setQueryData<Passes>(
              keys.seriesPasses(titleId),
              (p) => p && { ...p, passes: p.passes + 1, lastAt: at },
            );
        }
        if (open.options.onLog) return open.options.onLog();
        logTitleWatch(tmdbId, mediaType).then(
          (rows) => refresh(rows.titleId),
          () => {
            hapticFailure();
            if (titleId) refresh(titleId);
          },
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
    {
      key: 'watchlist',
      icon: 'bookmark',
      label: statusQ.data === 'watchlist' ? 'Remove from Watchlist' : 'Add to Watchlist',
      // Only a title that is on the Watchlist leaves it; any other status moves.
      run: () => setStatus((was) => (was === 'watchlist' ? null : 'watchlist')),
    },
    {
      key: 'rate',
      icon: 'star',
      label: 'Rate',
      run: () => openTitle(router, { tmdbId, mediaType, name }),
    },
    {
      key: 'share',
      icon: 'square.and.arrow.up',
      label: 'Share',
      run: () => {
        Share.share({
          message: `${name}\nhttps://www.themoviedb.org/${mediaType}/${tmdbId}`,
        }).catch(() => {});
      },
    },
    ...STATUSES.map(({ value, label }): Action => ({
      key: value,
      label,
      current: statusQ.data === value,
      run: () => setStatus(() => value),
    })),
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
    // Where this hold's finger was first seen, and whether it has moved since.
    let start: { x: number; y: number } | null = null;
    let armed = false;

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
        // The poster lifts where it is. The menu goes under it, or over it when
        // the title sits low; only when neither fits does the poster give way,
        // by the smaller of the two moves.
        const lo = i.top + EDGE;
        const hi = h - i.bottom - EDGE;
        const want = clamp(from.y + from.height / 2 - POSTER_H / 2, lo, hi - POSTER_H);
        const under = Math.min(want, hi - STACK_H); // poster top with the menu below
        const over = Math.max(want, lo + STACK_H - POSTER_H); // …with the menu above
        const below = want - under <= over - want;
        const top = below ? under : over;
        // Sharing the poster's edge on the side it sits on.
        const menuLeft = left + POSTER_W / 2 < w / 2 ? left : left + POSTER_W - MENU_W;
        const next: Open = {
          title,
          options,
          from,
          poster: { left, top },
          menu: {
            left: clamp(menuLeft, EDGE, w - EDGE - MENU_W),
            top: below ? top + POSTER_H + GAP : top - STACK_H + POSTER_H,
            above: !below,
          },
        };
        hapticHold();
        start = null;
        armed = false;
        live.current.open = next; // moves can arrive before React re-renders
        live.current.active = -1;
        setActive(-1);
        setOpen(next);
        lift.value = 0;
        // Critically damped: it arrives, it does not bounce.
        lift.value = withSpring(1, { damping: 32, stiffness: 260 });
      },
      move(x, y) {
        const { open: o, active: was } = live.current;
        if (!o) return;
        start ??= { x, y };
        armed ||= Math.hypot(x - start.x, y - start.y) >= ARM_DISTANCE;
        if (!armed) return;
        const inside =
          x >= o.menu.left - SIDE_SLOP && x <= o.menu.left + MENU_W + SIDE_SLOP;
        // Measured away from the poster, so one test serves both directions.
        const dy = o.menu.above
          ? o.menu.top + STATUS_TOP + STATUS_BLOCK_H - y
          : y - o.menu.top;
        const row = Math.floor((dy - MENU_PAD) / ROW_H);
        const cell = Math.floor((x - o.menu.left - MENU_PAD) / CELL_W);
        // The status row keeps answering a little past itself: it is the last
        // thing on the way, and the finger hides it.
        const onStatus = dy >= STATUS_TOP && dy < STATUS_TOP + STATUS_BLOCK_H + SIDE_SLOP;
        const next = !inside
          ? -1
          : row >= 0 && row < ROWS
            ? row
            : onStatus
              ? ROWS + clamp(cell, 0, STATUSES.length - 1)
              : -1;
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
          {
            left: open.menu.left,
            top: open.menu.top + (open.menu.above ? STATUS_BLOCK_H + BLOCK_GAP : 0),
            flexDirection: open.menu.above ? 'column-reverse' : 'column',
          },
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
        {actions.slice(0, ROWS).map((action, i) => {
          const on = i === active;
          // The lit row is a teal fill: a finger covers most of it, so the
          // edge that shows has to be unmistakable.
          const ink = on ? AccentText : c.text;
          return (
            <View
              key={action.key}
              style={[styles.row, on && { backgroundColor: Accent }]}>
              {action.icon && <IconSymbol name={action.icon} size={20} tintColor={ink} />}
              <ThemedText
                type="label"
                style={[styles.rowLabel, { color: ink }]}
                numberOfLines={1}>
                {action.label}
              </ThemedText>
              {action.detail && (
                <ThemedText
                  type="smallBold"
                  style={{ color: on ? AccentText : c.textSecondary }}>
                  {action.detail}
                </ThemedText>
              )}
            </View>
          );
        })}
      </Animated.View>

      {/* The Library statuses, as one row of their own under the menu. */}
      <Animated.View
        style={[
          styles.menu,
          styles.statuses,
          {
            left: open.menu.left,
            top: open.menu.top + (open.menu.above ? 0 : STATUS_TOP),
          },
          !CAN_BLUR && { backgroundColor: c.backgroundElement },
          menuStyle,
        ]}>
        {CAN_BLUR && (
          <BlurView
            style={StyleSheet.absoluteFill}
            intensity={90}
            tint={
              scheme === 'dark' ? 'systemThickMaterialDark' : 'systemThickMaterialLight'
            }
          />
        )}
        {actions.slice(ROWS).map((action, i) => {
          const on = ROWS + i === active;
          return (
            <View
              key={action.key}
              style={[
                styles.cell,
                // The status the title has now: the page's ink as a fill, the
                // strongest mark there is short of the teal under a finger.
                action.current && { backgroundColor: c.text },
                on && { backgroundColor: Accent },
              ]}>
              <ThemedText
                type="smallBold"
                style={{
                  color: on ? AccentText : action.current ? c.background : c.text,
                  fontSize: 13,
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}>
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
  statuses: { flexDirection: 'row' },
  cell: {
    width: CELL_W,
    height: STATUS_H,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  rowLabel: { flex: 1 },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: 14,
  },
});
