import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
} from '@expo-google-fonts/archivo';
import {
  BodoniModa_600SemiBold,
  BodoniModa_700Bold,
} from '@expo-google-fonts/bodoni-moda';
import { focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { type ComponentProps, useEffect } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { SwipeNav } from '@/components/swipe-nav';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { asyncStoragePersister, queryClient } from '@/lib/query';
import {
  ThemePreferenceProvider,
  useThemePreference,
} from '@/lib/theme-preference';

type ScreenLayoutProps = Parameters<
  NonNullable<ComponentProps<typeof Stack>['screenLayout']>
>[0];

/**
 * Wraps every screen of the root stack. On Android the native stack has no
 * swipe-back — only the OS edge gesture — so a rightward swipe anywhere on a
 * pushed screen goes back from here. iOS already has the full-screen native
 * one (`fullScreenGestureEnabled` below), so the pan stays disabled there.
 * Screens that opt out of the native gesture (`gestureEnabled: false`) opt
 * out of this one too, and the stack's first screen has nowhere to go.
 */
function StackScreenLayout({ navigation, options, children }: ScreenLayoutProps) {
  const back =
    Platform.OS === 'android' &&
    options.gestureEnabled !== false &&
    navigation.canGoBack()
      ? () => navigation.goBack()
      : undefined;
  return <SwipeNav onSwipeRight={back}>{children}</SwipeNav>;
}

function RootNavigator() {
  const { session, initialized } = useAuth();
  const { loaded: themeLoaded } = useThemePreference();
  const [fontsLoaded] = useFonts({
    BodoniModa_700Bold,
    BodoniModa_600SemiBold,
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
  });

  // Clear cached query data when signed out so nothing leaks between accounts.
  useEffect(() => {
    if (!session) queryClient.clear();
  }, [session]);

  // Wait for the initial session check (avoid flashing sign-in), the saved theme
  // preference (avoid flashing the wrong scheme), and the typefaces (avoid a
  // flash of system font before Bodoni/Archivo load).
  if (!initialized || !themeLoaded || !fontsLoaded) return null;

  return (
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
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      {/* Always reachable — the OAuth redirect deep-links here on Android before
          a session exists, so it must sit outside the session guards. */}
      <Stack.Screen name="auth-callback" />
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="title/[id]" />
        {/* Sibling of the title screen, reachable by a leftward swipe
            (SwipeNav): it slides in like the next page of a pager and the
            back swipe slides it out the same way. */}
        <Stack.Screen
          name="title/[id]/reviews"
          options={{ animation: 'slide_from_right', animationMatchesGesture: true }}
        />
        {/* Reached from a title's review list and from a notification; they
            cover the tab bar. */}
        <Stack.Screen name="review/[ratingId]" />
        <Stack.Screen name="review/[ratingId]/likes" />
        <Stack.Screen name="season" />
        <Stack.Screen name="diary" />
        <Stack.Screen name="stats" />
        <Stack.Screen name="import-data" />
        <Stack.Screen name="import-tvtime" />
        <Stack.Screen name="import-watchbuddy" />
        <Stack.Screen name="edit-profile" />
        <Stack.Screen name="about" />
        <Stack.Screen name="library-section" />
        <Stack.Screen name="trending-section" />
        <Stack.Screen name="user/[id]" />
        <Stack.Screen name="user/[id]/followers" />
        <Stack.Screen name="user/[id]/following" />
      </Stack.Protected>
    </Stack>
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
        persistOptions={{ persister: asyncStoragePersister }}>
        <ThemePreferenceProvider>
          <AuthProvider>
            <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
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
