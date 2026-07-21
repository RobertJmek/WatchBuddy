import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';

export default function SignInScreen() {
  const { sendCode, verifyCode, signInWithProvider } = useAuth();
  const c = useTheme();
  const isDark = useColorScheme() === 'dark';

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSend() {
    if (!email.includes('@')) {
      Alert.alert('Enter a valid email');
      return;
    }
    setBusy(true);
    const { error } = await sendCode(email);
    setBusy(false);
    if (error) Alert.alert('Could not send code', error);
    else setCodeSent(true);
  }

  async function handleVerify() {
    setBusy(true);
    const { error } = await verifyCode(email, code);
    setBusy(false);
    if (error) Alert.alert('Invalid or expired code', error);
  }

  async function handleGoogle() {
    setBusy(true);
    const { error } = await signInWithProvider('google');
    setBusy(false);
    if (error) Alert.alert('Google sign-in failed', error);
  }

  const inputStyle = [
    styles.input,
    { color: c.text, backgroundColor: c.backgroundElement },
  ];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Image
          style={[
            styles.logo,
            { borderColor: c.border },
            // Light: a physical drop shadow lifts the tile off warm paper. Dark:
            // the near-black tile vanishes into the near-black theater, so we lift
            // it with a warm amber "projector glow" halo instead — on-brand, and
            // it's what actually defines the icon on this background.
            isDark
              ? { shadowColor: c.glow, shadowOpacity: 0.32, shadowRadius: 28 }
              : { shadowColor: '#1A1714', shadowOpacity: 0.18, shadowRadius: 24 },
          ]}
          source={require('@/assets/images/icon.png')}
          contentFit="contain"
        />
        <ThemedText type="title" style={styles.brand}>
          WatchBuddy
        </ThemedText>
        <ThemedText type="meta" style={[styles.tagline, { color: c.textSecondary }]}>
          Track everything you watch
        </ThemedText>

        {!codeSent && (
          <>
            <Pressable
              style={[styles.secondaryBtn, { borderColor: c.border }]}
              onPress={handleGoogle}
              disabled={busy}>
              <Image
                style={styles.googleIcon}
                source={require('@/assets/images/google-g.png')}
                contentFit="contain"
              />
              <ThemedText type="smallBold">Continue with Google</ThemedText>
            </Pressable>
            <ThemedText type="meta" style={[styles.or, { color: c.textSecondary }]}>
              or with email
            </ThemedText>
          </>
        )}

        {!codeSent ? (
          <>
            <TextInput
              style={inputStyle}
              placeholder="you@example.com"
              placeholderTextColor={c.textSecondary}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              editable={!busy}
              onChangeText={setEmail}
            />
            <Button title="Send code" onPress={handleSend} disabled={busy} />
          </>
        ) : (
          <>
            <ThemedText type="meta" style={[styles.hint, { color: c.textSecondary }]}>
              We emailed a sign-in code to
            </ThemedText>
            <ThemedText style={[styles.email, { color: c.text }]}>
              {email}
            </ThemedText>
            <TextInput
              style={[styles.codeInput, { color: c.text, backgroundColor: c.backgroundElement }]}
              placeholder="········"
              placeholderTextColor={c.border}
              keyboardType="number-pad"
              maxLength={8}
              value={code}
              editable={!busy}
              onChangeText={setCode}
            />
            <Button title="Verify & sign in" onPress={handleVerify} disabled={busy} />
            <Pressable
              onPress={() => {
                setCodeSent(false);
                setCode('');
              }}
              disabled={busy}>
              <ThemedText type="small" style={[styles.link, { color: Accent }]}>
                Use a different email
              </ThemedText>
            </Pressable>
          </>
        )}

        {busy && <ActivityIndicator style={{ marginTop: Spacing.two }} />}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  // The ticket is the hero — sized like a real app icon and lifted off the warm
  // paper with a soft ambient shadow so the black tile reads as an object resting
  // on the page, not a sticker floating on it.
  logo: {
    width: 148,
    height: 148,
    borderRadius: 34,
    borderWidth: 1,
    alignSelf: 'center',
    marginBottom: Spacing.three,
    // Shadow color/opacity/radius are set inline (theme-aware); offset stays fixed.
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  brand: { textAlign: 'center' },
  tagline: { textAlign: 'center', marginBottom: Spacing.three },
  input: {
    fontFamily: Type.body,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  googleIcon: { width: 18, height: 18 },
  or: { textAlign: 'center' },
  // Two-part sender line: quiet label, then the address it was sent to standing
  // on its own at full text contrast so it can't get lost in the muted copy.
  hint: { textAlign: 'center', marginBottom: -Spacing.two },
  email: {
    textAlign: 'center',
    fontFamily: Type.semibold,
    fontSize: 17,
  },
  // The code reads like a ticket number: centered, widely tracked, larger than a
  // plain field — the one distinctive touch on this screen.
  codeInput: {
    fontFamily: Type.medium,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 26,
    textAlign: 'center',
    letterSpacing: 8,
  },
  link: { textAlign: 'center' },
});
