import { focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/lib/auth-context';
import { asyncStoragePersister, queryClient } from '@/lib/query';

function RootNavigator() {
  const { session, initialized } = useAuth();

  // Clear cached query data when signed out so nothing leaks between accounts.
  useEffect(() => {
    if (!session) queryClient.clear();
  }, [session]);

  // Wait for the initial session check so we don't flash the sign-in screen.
  if (!initialized) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="title/[id]" />
        <Stack.Screen name="season" />
        <Stack.Screen name="diary" />
        <Stack.Screen name="stats" />
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
      <AuthProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <RootNavigator />
        </ThemeProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
