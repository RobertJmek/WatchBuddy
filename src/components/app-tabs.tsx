import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigator } from 'expo-router';
import {
  TabList,
  type TabListProps,
  TabTrigger,
  type TabTriggerSlotProps,
  Tabs,
} from 'expo-router/ui';
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  Image,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import PagerView, { type PagerViewProps } from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/icon-symbol';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { keys } from '@/lib/keys';
import { useAuth } from '@/lib/auth-context';
import { getUnreadCount, subscribeToNotifications } from '@/lib/notifications';
import { TabPagerProvider } from '@/lib/tab-pager';
import { emitTabReset } from '@/lib/tab-reset';

/**
 * The four tabs, swipeable. `NativeTabs` has no swipe primitive, so this is the
 * headless `Tabs` from `expo-router/ui` plus a `PagerView` holding all four tab
 * screens side by side: the pager owns the horizontal swipe and the navigation
 * state follows it (`onPageSelected` → `JUMP_TO`), while a tab press moves the
 * pager (`state.index` → `setPage`). The bar is a JS `View` — the trade
 * (SF Symbols, the native badge, iOS 26's glass) is recorded in ADR 0023.
 *
 * Every tab body owns horizontal gestures of its own — swipe-to-log rows in
 * Search, swipe-to-dismiss in the Feed, poster shelves everywhere. They win
 * over the page swipe by threshold: each activates well under ViewPager2's
 * 16dp paging slop, and RNGH's root view sees every touch before the pager
 * does. iOS has no such ordering between two UIKit scroll recognizers, which is
 * what `TabPagerProvider` is for (see `src/lib/tab-pager.tsx`).
 */

/**
 * The bar's order, left to right — and therefore the pager's. The navigator's
 * own `state.routes` is *not* in this order: expo-router sorts a tab
 * navigator's routes with `sortRoutes` (index and group routes first, then by
 * name length), which puts `(library)` before `feed`. The triggers below and
 * the pages in `PagedTabSlot` both follow this list, so a swipe reaches the
 * neighbour the bar shows.
 */
const TAB_ORDER = ['feed', '(library)', 'explore', 'profile'] as const;

export default function AppTabs() {
  // Unread personal notifications badge the Feed tab (their home).
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { data: unread = 0 } = useQuery({
    queryKey: keys.notifUnread(),
    queryFn: getUnreadCount,
    enabled: !!session,
  });
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    return subscribeToNotifications(uid, () => {
      queryClient.invalidateQueries({ queryKey: keys.notifUnread() });
    });
  }, [session?.user.id, queryClient]);

  return (
    <Tabs>
      <PagedTabSlot />
      <TabList asChild>
        <TabBar>
          <TabTrigger name="feed" href="/feed" asChild>
            <TabButton
              label="Feed"
              icon={(color) => (
                <IconSymbol name="rectangle.stack.fill" size={22} tintColor={color} />
              )}
              badge={unread}
              badgeNoun="unread notifications"
            />
          </TabTrigger>
          {/* `onPress` runs before the switch, on every press — including a
              re-press of the focused tab, which is the one tab-reset reacts to. */}
          <TabTrigger
            name="(library)"
            href="/"
            asChild
            onPress={() => emitTabReset('library')}>
            <TabButton
              label="Library"
              icon={(color) => (
                <TintedImage
                  source={require('@/assets/images/tabIcons/home.png')}
                  color={color}
                />
              )}
            />
          </TabTrigger>
          <TabTrigger
            name="explore"
            href="/explore"
            asChild
            onPress={() => emitTabReset('explore')}>
            <TabButton
              label="Search"
              icon={(color) => (
                <TintedImage
                  source={require('@/assets/images/tabIcons/explore.png')}
                  color={color}
                />
              )}
            />
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton
              label="Profile"
              icon={(color) => (
                <IconSymbol name="person.crop.circle" size={22} tintColor={color} />
              )}
            />
          </TabTrigger>
        </TabBar>
      </TabList>
    </Tabs>
  );
}

/**
 * All tab screens mounted side by side in a pager, in `TAB_ORDER`. Replaces
 * `TabSlot`, which renders only the focused one (the rest `display: none`).
 * A page that is swiped to is not "focused" until the pager settles and
 * dispatches the jump, so `useIsFocused` inside a screen (the Feed badge)
 * still keys on the navigation state, not on what is visible mid-drag.
 *
 * A pager position and a route index are two different numbers here (see
 * `TAB_ORDER`), translated by `pageOf` / `pages[position]` on the way in and
 * out. `settled` holds a pager position.
 */
function PagedTabSlot() {
  const { state, navigation, descriptors } = Navigator.useContext();
  const pager = useRef<PagerView>(null);

  // The routes in bar order; one that isn't registered simply has no page.
  const pages = useMemo(
    () =>
      TAB_ORDER.map((name) => state.routes.find((r) => r.name === name)).filter(
        (r) => r !== undefined,
      ),
    [state.routes],
  );
  const pageOf = useCallback(
    (routeIndex: number) =>
      pages.findIndex((r) => r.key === state.routes[routeIndex]?.key),
    [pages, state.routes],
  );
  const page = pageOf(state.index);

  // The pager reports the page it settled on even when we asked for it, so
  // this ref is what stops a tab press from dispatching a second jump.
  const settled = useRef(page);

  // Tab press (or any other navigation) → pager follows.
  useEffect(() => {
    if (page < 0 || settled.current === page) return;
    settled.current = page;
    pager.current?.setPage(page);
  }, [page]);

  const onPageSelected = useCallback<NonNullable<PagerViewProps['onPageSelected']>>(
    (e) => {
      const position = e.nativeEvent.position;
      if (settled.current === position) return;
      settled.current = position;
      const route = pages[position];
      if (!route || state.routes[state.index]?.key === route.key) return;
      // The same action `TabTrigger` dispatches when it has no trigger config.
      navigation.dispatch({ type: 'JUMP_TO', payload: { name: route.name } });
    },
    [navigation, pages, state],
  );

  // The pager's own scroll, as a handler a JS pan inside a page can name — see
  // `src/lib/tab-pager.tsx`. Built once: a new gesture object per render would
  // re-attach the detector on every badge update.
  const native = useMemo(() => Gesture.Native(), []);
  const tabPager = useMemo(
    () => ({
      native,
      setScrollEnabled: (enabled: boolean) => pager.current?.setScrollEnabled(enabled),
    }),
    [native],
  );

  return (
    <TabPagerProvider value={tabPager}>
      <GestureDetector gesture={native}>
        <PagerView
          ref={pager}
          style={styles.pager}
          initialPage={Math.max(page, 0)}
          // Keep all four pages attached. The default lets the pager detach
          // off-screen pages, and the Library page hosts a native Stack —
          // re-attaching one is not a path worth discovering on device. It
          // also matches what NativeTabs did: every tab stayed mounted, so
          // Feed offsets and Search state survive a round trip.
          offscreenPageLimit={3}
          overdrag={false}
          keyboardDismissMode="on-drag"
          onPageSelected={onPageSelected}>
          {pages.map((route) => (
            <View key={route.key} style={styles.page}>
              {descriptors[route.key].render()}
            </View>
          ))}
        </PagerView>
      </GestureDetector>
    </TabPagerProvider>
  );
}

function TabBar({ children, style, ...props }: TabListProps) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      {...props}
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          backgroundColor: c.background,
          borderTopColor: c.border,
          paddingBottom: Math.max(insets.bottom, Spacing.two),
        },
        style,
      ]}>
      {children}
    </View>
  );
}

type TabButtonProps = TabTriggerSlotProps & {
  label: string;
  icon: (color: string) => ReactNode;
  badge?: number;
  /** Spoken after the badge count — the caller names the thing (ADR 0018). */
  badgeNoun?: string;
};

function TabButton({
  label,
  icon,
  badge = 0,
  badgeNoun,
  isFocused,
  // `TabTrigger` hands down a row-direction style meant for its own
  // Pressable; the button lays itself out.
  style: _style,
  ...props
}: TabButtonProps) {
  const c = useTheme();
  const color = isFocused ? c.tint : c.textSecondary;
  const spoken = badge > 0 && badgeNoun ? `${label}, ${badge} ${badgeNoun}` : label;
  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityLabel={spoken}
      accessibilityState={{ selected: !!isFocused }}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <View>
        {icon(color)}
        {badge > 0 && (
          <View style={[styles.badge, { backgroundColor: c.tint }]}>
            <Text style={styles.badgeText}>{badge > 99 ? '99+' : String(badge)}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

/** The PNG tab icons are template images: one glyph, tinted per state. */
function TintedImage({
  source,
  color,
}: {
  source: ImageSourcePropType;
  color: ComponentProps<typeof Image>['tintColor'];
}) {
  return <Image source={source} style={styles.pngIcon} tintColor={color} />;
}

const styles = StyleSheet.create({
  pager: { flex: 1 },
  page: { flex: 1 },
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
  },
  pressed: { opacity: 0.6 },
  label: { fontFamily: Type.medium, fontSize: 11 },
  pngIcon: { width: 22, height: 22 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontFamily: Type.bold, fontSize: 10 },
});
