import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
} from '@expo-google-fonts/archivo';
import { LeagueGothic_400Regular } from '@expo-google-fonts/league-gothic';
import { focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { type ComponentProps, useEffect } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { AvatarCropperHost } from '@/components/avatar-cropper';
import { KeyboardDismissButton } from '@/components/keyboard-dismiss-button';
import { SwipeNav } from '@/components/swipe-nav';
import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { markWelcomeSeen, useWelcomeSeen } from '@/lib/onboarding';
import { CACHE_MAX_AGE, asyncStoragePersister, queryClient } from '@/lib/query';
import {
  ThemePreferenceProvider,
  useThemePreference,
} from '@/lib/theme-preference';

// React Navigation paints native headers with `colors.card`, which is pure
// white in its DefaultTheme — a white bar above every cream screen that shows
// a header. Derive the navigation theme from the app's own palette instead.
function navTheme(base: typeof DefaultTheme, c: (typeof Colors)['light' | 'dark']) {
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: c.tint,
      background: c.background,
      card: c.background,
      text: c.text,
      border: c.border,
    },
  };
}
const NavLight = navTheme(DefaultTheme, Colors.light);
const NavDark = navTheme(DarkTheme, Colors.dark);

type ScreenLayoutProps = Parameters<
  NonNullable<ComponentProps<typeof Stack>['screenLayout']>
>[0];

/**
 * Screens that open from the bottom and close downward (on iOS, pulling the
 * page past its top — `src/lib/pull-to-dismiss.ts`; on Android, back or the
 * swipe right below). Their native horizontal swipe is
 * off: react-native-screens drives one direction per screen, and a sideways
 * drag popping a sheet-style screen sideways is the wrong picture. The JS
 * rightward swipe below stands in for it on both platforms.
 */
const MODAL_ROUTES = new Set(['title/[id]', 'review/[ratingId]']);
const modalOptions = {
  animation: 'slide_from_bottom',
  gestureEnabled: false,
} as const;

/**
 * Wraps every screen of the root stack with a rightward swipe that goes back
 * wherever the native stack has none: on Android (which only has the OS edge
 * gesture) and, on both platforms, on the modal routes above. iOS's own
 * full-screen gesture (`fullScreenGestureEnabled` below) covers the rest.
 * Screens that opt out of the native gesture (`gestureEnabled: false`) opt out
 * of this one too, and the stack's first screen has nowhere to go.
 */
function StackScreenLayout({ route, navigation, options, children }: ScreenLayoutProps) {
  const modal = MODAL_ROUTES.has(route.name);
  const back =
    (Platform.OS === 'android' || modal) &&
    (modal || options.gestureEnabled !== false) &&
    navigation.canGoBack()
      ? () => navigation.goBack()
      : undefined;
  return <SwipeNav onSwipeRight={back}>{children}</SwipeNav>;
}

function RootNavigator() {
  const { session, initialized } = useAuth();
  const { loaded: themeLoaded } = useThemePreference();
  const welcomeSeen = useWelcomeSeen();
  const [fontsLoaded] = useFonts({
    LeagueGothic_400Regular,
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
  });

  // Clear cached query data when signed out so nothing leaks between accounts —
  // once the session check has answered (before it, `session` is null for
  // everyone), and the persisted copy too: the persister writes the emptied
  // cache only after its throttle, so an app killed right after sign-out would
  // otherwise restore the previous account's data on the next launch.
  useEffect(() => {
    if (!initialized || session) return;
    queryClient.clear();
    void asyncStoragePersister.removeClient();
  }, [initialized, session]);

  // Wait for the initial session check (avoid flashing sign-in), the saved theme
  // preference (avoid flashing the wrong scheme), and the typefaces (avoid a
  // flash of system font before the fonts load).
  // Anyone already signed in on this install is past the welcome screen; this
  // keeps it from appearing after an existing user's later sign-out.
  useEffect(() => {
    if (session) markWelcomeSeen();
  }, [session]);

  if (!initialized || !themeLoaded || !fontsLoaded || welcomeSeen === null) return null;

  return (
    <>
    <Stack
      screenLayout={(props) => <StackScreenLayout {...props} />}
      screenOptions={{
        headerShown: false,
        headerBackButtonDisplayMode: 'minimal',
        // Headers are hidden, so the swipe is the only back affordance on
        // iOS. Widen it from the left edge to the whole screen (iOS 26 does
        // this by default; this makes iOS 18 and below match). Android gets
        // the same from `StackScreenLayout` above, on top of the OS back
        // gesture. Screens that own a horizontal pan mid-screen (drag-to-rate
        // on a title, swipe-to-log on a season) may need to opt out per
        // screen if the two gestures fight on device.
        fullScreenGestureEnabled: true,
      }}>
      {/* First screen = signed-out fallback. Expo Router redirects to the
          first available screen whenever a guard kicks the user out, so
          sign-in must come before auth-callback or logout lands on the
          OAuth-callback error screen. */}
      <Stack.Protected guard={!session}>
        {/* The first launch of an install opens on the welcome screen;
            Get started marks it seen, which drops it from the stack and
            lands on sign-in (ADR 0028). */}
        <Stack.Protected guard={!welcomeSeen}>
          <Stack.Screen name="welcome" options={{ gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
      </Stack.Protected>
      {/* Always reachable — the OAuth redirect deep-links here on Android before
          a session exists, so it must sit outside the session guards. */}
      <Stack.Screen name="auth-callback" />
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
        {/* A new account's profile step, then the tutorial, each replacing
            the last. A fade reads as one flow rather than pushed screens. */}
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="tutorial" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="title/[id]" options={modalOptions} />
        {/* Sibling of the title screen, reachable by a leftward swipe
            (SwipeNav): it slides in like the next page of a pager and the
            native back swipe slides it out the same way. */}
        <Stack.Screen
          name="title/[id]/reviews"
          options={{ animation: 'slide_from_right', animationMatchesGesture: true }}
        />
        {/* Reached from a title's review list and from a notification; they
            cover the tab bar. */}
        <Stack.Screen name="review/[ratingId]" options={modalOptions} />
        <Stack.Screen name="review/[ratingId]/likes" />
        <Stack.Screen name="season" />
        <Stack.Screen name="diary" />
        <Stack.Screen name="stats" />
        <Stack.Screen name="import-data" />
        <Stack.Screen name="import-tvtime" />
        <Stack.Screen name="import-watchbuddy" />
        <Stack.Screen name="edit-profile" />
        <Stack.Screen name="blocked" />
        <Stack.Screen name="about" />
        <Stack.Screen name="library-section" />
        <Stack.Screen name="trending-section" />
        <Stack.Screen name="user/[id]" />
        <Stack.Screen name="user/[id]/followers" />
        <Stack.Screen name="user/[id]/following" />
        <Stack.Screen name="user/[id]/ratings" />
      </Stack.Protected>
    </Stack>
    {/* iOS hide-keyboard chevron for every screen (ADR 0028). */}
    <KeyboardDismissButton />
    {/* The round avatar crop that pickAvatarImage() opens. */}
    <AvatarCropperHost />
    </>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Refetch stale queries when the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      focusManager.setFocused(status === 'active');
    });
    return () => sub.remove();
  }, []);

  return (
    // Outermost: gesture handling for the whole app (swipe-to-log lives here).
    // Without this root view, gestures are silently ignored on device.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: asyncStoragePersister, maxAge: CACHE_MAX_AGE }}>
        <ThemePreferenceProvider>
          <AuthProvider>
            <ThemeProvider value={colorScheme === 'dark' ? NavDark : NavLight}>
              <KeyboardProvider>
                <RootNavigator />
              </KeyboardProvider>
            </ThemeProvider>
          </AuthProvider>
        </ThemePreferenceProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
