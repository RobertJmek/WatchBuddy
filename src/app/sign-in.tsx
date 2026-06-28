import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  StyleSheet,
  TextInput,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

export default function SignInScreen() {
  const { sendCode, verifyCode, signInWithProvider } = useAuth();
  const scheme = useColorScheme();
  const textColor = scheme === 'dark' ? '#fff' : '#000';
  const borderColor = scheme === 'dark' ? '#444' : '#ccc';

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
    // On success, the auth listener flips the session and the router redirects.
    if (error) Alert.alert('Invalid or expired code', error);
  }

  async function handleGoogle() {
    setBusy(true);
    const { error } = await signInWithProvider('google');
    setBusy(false);
    if (error) Alert.alert('Google sign-in failed', error);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">WatchBuddy</ThemedText>
        <ThemedText type="subtitle">Sign in</ThemedText>

        {!codeSent && (
          <>
            <Button title="Continue with Google" onPress={handleGoogle} disabled={busy} />
            <ThemedText type="small" style={styles.or}>
              — or with email —
            </ThemedText>
          </>
        )}

        {!codeSent ? (
          <>
            <TextInput
              style={[styles.input, { color: textColor, borderColor }]}
              placeholder="you@example.com"
              placeholderTextColor={borderColor}
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
            <ThemedText style={styles.hint}>
              We emailed a 6-digit code to {email}.
            </ThemedText>
            <TextInput
              style={[styles.input, { color: textColor, borderColor }]}
              placeholder="12345678"
              placeholderTextColor={borderColor}
              keyboardType="number-pad"
              maxLength={8}
              value={code}
              editable={!busy}
              onChangeText={setCode}
            />
            <Button title="Verify & sign in" onPress={handleVerify} disabled={busy} />
            <Button
              title="Use a different email"
              onPress={() => {
                setCodeSent(false);
                setCode('');
              }}
              disabled={busy}
            />
          </>
        )}

        {busy && <ActivityIndicator />}
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
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    fontSize: 16,
  },
  hint: { textAlign: 'center' },
  or: { textAlign: 'center', opacity: 0.6 },
});
