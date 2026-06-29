import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';

export default function SignInScreen() {
  const { sendCode, verifyCode, signInWithProvider } = useAuth();
  const c = useTheme();

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
          style={styles.logo}
          source={require('@/assets/images/icon.png')}
          contentFit="contain"
        />
        <ThemedText type="title" style={styles.brand}>
          WatchBuddy
        </ThemedText>
        <ThemedText type="small" style={[styles.tagline, { color: c.textSecondary }]}>
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
            <ThemedText type="small" style={[styles.or, { color: c.textSecondary }]}>
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
            <Pressable style={styles.primaryBtn} onPress={handleSend} disabled={busy}>
              <ThemedText style={styles.primaryText}>Send code</ThemedText>
            </Pressable>
          </>
        ) : (
          <>
            <ThemedText style={[styles.hint, { color: c.textSecondary }]}>
              We emailed a sign-in code to {email}.
            </ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="Enter code"
              placeholderTextColor={c.textSecondary}
              keyboardType="number-pad"
              maxLength={8}
              value={code}
              editable={!busy}
              onChangeText={setCode}
            />
            <Pressable style={styles.primaryBtn} onPress={handleVerify} disabled={busy}>
              <ThemedText style={styles.primaryText}>Verify & sign in</ThemedText>
            </Pressable>
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
  logo: {
    width: 88,
    height: 88,
    borderRadius: 20,
    alignSelf: 'center',
    marginBottom: Spacing.two,
  },
  brand: { textAlign: 'center' },
  tagline: { textAlign: 'center', marginBottom: Spacing.three },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  primaryBtn: {
    backgroundColor: Accent,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  primaryText: { color: AccentText, fontWeight: '700', fontSize: 16 },
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
  hint: { textAlign: 'center' },
  link: { textAlign: 'center' },
});
