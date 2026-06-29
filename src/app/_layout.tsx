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
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/lib/auth-context';
import { asyncStoragePersister, queryClient } from '@/lib/query';
import {
  ThemePreferenceProvider,
  useThemePreference,
} from '@/lib/theme-preference';

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
      screenOptions={{
        headerShown: false,
        headerBackButtonDisplayMode: 'minimal',
      }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="title/[id]" />
        <Stack.Screen name="title/[id]/reviews" />
        <Stack.Screen name="season" />
        <Stack.Screen name="diary" />
        <Stack.Screen name="edit-profile" />
        <Stack.Screen name="library-section" />
        <Stack.Screen name="user/[id]" />
        <Stack.Screen name="user/[id]/followers" />
        <Stack.Screen name="user/[id]/following" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
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
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: asyncStoragePersister }}>
      <ThemePreferenceProvider>
        <AuthProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <RootNavigator />
          </ThemeProvider>
        </AuthProvider>
      </ThemePreferenceProvider>
    </PersistQueryClientProvider>
  );
}
