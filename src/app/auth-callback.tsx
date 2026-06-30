import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * Landing route for the OAuth redirect (`watchbuddy://auth-callback?code=...`).
 *
 * On iOS the in-app browser captures the redirect and the sign-in code is
 * exchanged before we ever get here. On Android the OS delivers the redirect to
 * the app as a deep link instead, so without this route Expo Router shows
 * "page could not be found." We finish the PKCE exchange here, then the session
 * guard in the root layout swaps us into the app.
 */
export default function AuthCallback() {
  const { session } = useAuth();
  const router = useRouter();
  const c = useTheme();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [error, setError] = useState<string | null>(null);

  // As soon as a session exists, leave this route for the app. Covers the case
  // where the in-app browser already completed the exchange before we mounted.
  useEffect(() => {
    if (session) router.replace('/');
  }, [session, router]);

  // No session yet: complete the exchange ourselves (the Android path).
  useEffect(() => {
    if (session) return;
    let active = true;
    (async () => {
      if (!code) {
        setError('Missing sign-in code. Please try signing in again.');
        return;
      }
      const { error: exchangeError } =
        await supabase.auth.exchangeCodeForSession(code);
      if (!active || !exchangeError) return;
      // The code may already have been spent by the in-app browser path; if a
      // session landed anyway, the redirect effect above takes over.
      const { data } = await supabase.auth.getSession();
      if (active && !data.session) setError(exchangeError.message);
    })();
    return () => {
      active = false;
    };
  }, [code, session]);

  return (
    <ThemedView style={styles.container}>
      {error ? (
        <>
          <ThemedText style={styles.message}>{error}</ThemedText>
          <ThemedText
            onPress={() => router.replace('/sign-in')}
            style={[styles.link, { color: c.tint }]}>
            Back to sign in
          </ThemedText>
        </>
      ) : (
        <>
          <ActivityIndicator color={c.tint} />
          <ThemedText style={[styles.message, { color: c.textSecondary }]}>
            Signing you in…
          </ThemedText>
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  message: { textAlign: 'center' },
  link: { fontWeight: '600' },
});
