import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';

import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

type AuthState = {
  /** The current Supabase session, or null when signed out. */
  session: Session | null;
  /** False until the initial session check has resolved. */
  initialized: boolean;
  /** Email the 6-digit one-time code. */
  sendCode: (email: string) => Promise<{ error: string | null }>;
  /** Verify the 6-digit code to complete sign-in. */
  verifyCode: (email: string, token: string) => Promise<{ error: string | null }>;
  /** Sign in via an OAuth provider through an in-app browser. */
  signInWithProvider: (
    provider: 'google' | 'apple',
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setInitialized(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  async function sendCode(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },
    });
    return { error: error?.message ?? null };
  }

  async function verifyCode(email: string, token: string) {
    const cleanEmail = email.trim().toLowerCase();
    const cleanToken = token.trim();

    // Try the OTP / magic-link token type first (used when "Confirm email" is
    // off). If that's rejected, retry as a signup-confirmation token (used when
    // "Confirm email" is on). A wrong-type attempt doesn't consume the real
    // token, so the fallback still succeeds.
    const first = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'email',
    });
    if (!first.error) return { error: null };

    const second = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'signup',
    });
    return { error: second.error?.message ?? null };
  }

  async function signInWithProvider(provider: 'google' | 'apple') {
    const redirectTo = Linking.createURL('auth-callback');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) return { error: error.message };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return { error: null }; // user cancelled

    const { queryParams } = Linking.parse(result.url);
    const code = queryParams?.code as string | undefined;
    if (!code) return { error: 'No authorization code returned' };

    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);
    return { error: exchangeError?.message ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        initialized,
        sendCode,
        verifyCode,
        signInWithProvider,
        signOut,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
