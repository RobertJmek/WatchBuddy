import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigator } from "expo-router";
import {
  TabList,
  type TabListProps,
  TabTrigger,
  type TabTriggerSlotProps,
  Tabs,
} from "expo-router/ui";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  Image,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import PagerView, { type PagerViewProps } from "react-native-pager-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Spacing, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { keys } from "@/lib/keys";
import { useAuth } from "@/lib/auth-context";
import { getUnreadCount, subscribeToNotifications } from "@/lib/notifications";
import { emitTabReset } from "@/lib/tab-reset";

/**
 * SPIKE A — swipe between the four tabs.
 *
 * `NativeTabs` has no swipe primitive, so this trades the native bar for the
 * headless `Tabs` from `expo-router/ui` plus a `PagerView` holding all four
 * tab screens side by side. The bar is a JS `View` (no SF Symbols, no native
 * badge, no iOS 26 glass); the pager owns the horizontal swipe and the
 * navigation state follows it (`onPageSelected` → `JUMP_TO`), while a tab
 * press moves the pager (`state.index` → `setPage`).
 *
 * Every tab body already owns horizontal gestures — swipe-to-log rows in
 * Search, swipe-to-dismiss in the Feed, poster shelves everywhere — so the
 * feel of "row swipe wins over page swipe" is the whole question this spike
 * exists to answer on a device. Nothing here is tuned yet.
 */

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
                <Feather name="layers" size={22} color={color} />
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
            onPress={() => emitTabReset("library")}
          >
            <TabButton
              label="Library"
              icon={(color) => (
                <TintedImage
                  source={require("@/assets/images/tabIcons/home.png")}
                  color={color}
                />
              )}
            />
          </TabTrigger>
          <TabTrigger
            name="explore"
            href="/explore"
            asChild
            onPress={() => emitTabReset("explore")}
          >
            <TabButton
              label="Search"
              icon={(color) => (
                <TintedImage
                  source={require("@/assets/images/tabIcons/explore.png")}
                  color={color}
                />
              )}
            />
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton
              label="Profile"
              icon={(color) => <Feather name="user" size={22} color={color} />}
            />
          </TabTrigger>
        </TabBar>
      </TabList>
    </Tabs>
  );
}

/**
 * All tab screens mounted side by side in a pager. Replaces `TabSlot`, which
 * renders only the focused one (the rest `display: none`). A page that is
 * swiped to is not "focused" until the pager settles and dispatches the jump,
 * so `useIsFocused` inside a screen (the Feed badge) still keys on the
 * navigation state, not on what is visible mid-drag.
 */
function PagedTabSlot() {
  const { state, navigation, descriptors } = Navigator.useContext();
  const pager = useRef<PagerView>(null);
  const index = state.index;

  // The pager reports the page it settled on even when we asked for it, so
  // this ref is what stops a tab press from dispatching a second jump.
  const settled = useRef(index);

  // Tab press (or any other navigation) → pager follows.
  useEffect(() => {
    if (settled.current === index) return;
    settled.current = index;
    pager.current?.setPage(index);
  }, [index]);

  const onPageSelected = useCallback<
    NonNullable<PagerViewProps["onPageSelected"]>
  >(
    (e) => {
      const position = e.nativeEvent.position;
      if (settled.current === position) return;
      settled.current = position;
      const route = state.routes[position];
      if (!route || state.index === position) return;
      // The same action `TabTrigger` dispatches when it has no trigger config.
      navigation.dispatch({ type: "JUMP_TO", payload: { name: route.name } });
    },
    [navigation, state],
  );

  return (
    <PagerView
      ref={pager}
      style={styles.pager}
      initialPage={index}
      overdrag={false}
      onPageSelected={onPageSelected}
    >
      {state.routes.map((route) => (
        <View key={route.key} style={styles.page}>
          {descriptors[route.key].render()}
        </View>
      ))}
    </PagerView>
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
      ]}
    >
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
  const spoken =
    badge > 0 && badgeNoun ? `${label}, ${badge} ${badgeNoun}` : label;
  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityLabel={spoken}
      accessibilityState={{ selected: !!isFocused }}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
    >
      <View>
        {icon(color)}
        {badge > 0 && (
          <View style={[styles.badge, { backgroundColor: c.tint }]}>
            <Text style={styles.badgeText}>
              {badge > 99 ? "99+" : String(badge)}
            </Text>
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
  color: ComponentProps<typeof Image>["tintColor"];
}) {
  return <Image source={source} style={styles.pngIcon} tintColor={color} />;
}

const styles = StyleSheet.create({
  pager: { flex: 1 },
  page: { flex: 1 },
  bar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
    paddingVertical: Spacing.one,
  },
  pressed: { opacity: 0.6 },
  label: { fontFamily: Type.medium, fontSize: 11 },
  pngIcon: { width: 22, height: 22 },
  badge: {
    position: "absolute",
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontFamily: Type.bold, fontSize: 10 },
});
