import * as AppleAuthentication from 'expo-apple-authentication';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { Easing, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BarButton } from '@/components/bottom-bar';
import { Intro } from '@/components/intro';
import { Step } from '@/components/step';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const rise = (step: number) => FadeInDown.duration(450).delay(step * 80).easing(EASE_OUT);

export default function SignInScreen() {
  const { sendCode, verifyCode, signInWithProvider, signInWithApple } = useAuth();
  const c = useTheme();
  const isDark = useColorScheme() === 'dark';

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

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

  async function handleApple() {
    setBusy(true);
    const { error } = await signInWithApple();
    setBusy(false);
    if (error) Alert.alert('Apple sign-in failed', error);
  }

  const inputStyle = [
    styles.input,
    { color: c.text, backgroundColor: c.backgroundElement },
  ];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container}>
        {/* Scrolls so the button under the code field stays reachable: iOS's
            number pad has no Return key to put the keyboard away. */}
        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          bottomOffset={Spacing.six}>
          <Animated.View entering={rise(0)} style={styles.head}>
            <Image
              style={[
                styles.logo,
                { borderColor: c.border },
                // Light: a physical drop shadow lifts the tile off warm paper. Dark:
                // the near-black tile vanishes into the near-black theater, so we lift
                // it with a warm amber "projector glow" halo instead.
                isDark
                  ? { shadowColor: c.glow, shadowOpacity: 0.32, shadowRadius: 20 }
                  : { shadowColor: '#1A1714', shadowOpacity: 0.18, shadowRadius: 16 },
              ]}
              source={require('@/assets/images/icon.png')}
              contentFit="contain"
              accessibilityIgnoresInvertColors
            />
            <Intro title="Sign in" body="New here? Signing in creates your account." />
          </Animated.View>

          {/* No pinned bar (ADR 0030): Apple, Google and email are equal
              choices, so each sits in its own Step with its button under it. */}
          <Animated.View entering={rise(1)} style={styles.steps}>
            {!codeSent ? (
              <>
                <Step label={appleAvailable ? 'With Apple or Google' : 'With Google'}>
                  <View style={styles.buttons}>
                    {appleAvailable && (
                      // A custom button rather than AppleAuthenticationButton: the native
                      // one sets its own font and grows its label with its height, so it
                      // shouted over Google. HIG allows a custom button with the Apple
                      // logo, the "Continue with Apple" title and matching size.
                      <Pressable
                        style={[styles.secondaryBtn, { borderColor: c.border }]}
                        onPress={handleApple}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel="Continue with Apple"
                        accessibilityState={{ disabled: busy }}>
                        <SymbolView name="apple.logo" size={18} tintColor={c.text} />
                        <ThemedText type="smallBold">Continue with Apple</ThemedText>
                      </Pressable>
                    )}
                    <Pressable
                      style={[styles.secondaryBtn, { borderColor: c.border }]}
                      onPress={handleGoogle}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel="Continue with Google"
                      accessibilityState={{ disabled: busy }}>
                      <Image
                        style={styles.googleIcon}
                        source={require('@/assets/images/google-g.png')}
                        contentFit="contain"
                      />
                      <ThemedText type="smallBold">Continue with Google</ThemedText>
                    </Pressable>
                  </View>
                </Step>

                <Step label="Or with email" note="We'll email you a sign-in code">
                  <TextInput
                    style={inputStyle}
                    placeholder="you@example.com"
                    placeholderTextColor={c.textSecondary}
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    returnKeyType="send"
                    onSubmitEditing={handleSend}
                    value={email}
                    editable={!busy}
                    onChangeText={setEmail}
                    accessibilityLabel="Email"
                  />
                  <BarButton title="Send code" onPress={handleSend} disabled={busy} />
                </Step>
              </>
            ) : (
              <Step label="Enter the code" note={`We emailed it to ${email}`}>
                <TextInput
                  style={[styles.input, styles.codeInput, { color: c.text, backgroundColor: c.backgroundElement }]}
                  placeholder="········"
                  placeholderTextColor={c.border}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={code}
                  editable={!busy}
                  onChangeText={setCode}
                  accessibilityLabel="Sign-in code"
                />
                <BarButton title="Verify & sign in" onPress={handleVerify} disabled={busy} />
                <Pressable
                  style={styles.link}
                  onPress={() => {
                    setCodeSent(false);
                    setCode('');
                  }}
                  disabled={busy}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}>
                  <ThemedText type="smallBold" themeColor="tint">
                    Use a different email
                  </ThemedText>
                </Pressable>
              </Step>
            )}

            {busy && <ActivityIndicator />}
          </Animated.View>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // The tutorial-card measures: 24pt sides, 12 inside a group, 32 between groups.
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.five,
    gap: Spacing.five,
  },
  head: { gap: Spacing.four },
  // The ticket is the brand mark: an app-icon tile lifted off the page with a
  // soft shadow, so it reads as an object resting on it.
  logo: {
    width: 88,
    height: 88,
    borderRadius: 20,
    borderWidth: 1,
    // Shadow color/opacity/radius are set inline (theme-aware); offset stays fixed.
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  steps: { gap: Spacing.five },
  buttons: { gap: 12 },
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
  // The code reads like a ticket number: centered and larger than a plain
  // field. No letterSpacing: iOS recycles this native view into later
  // TextInputs (Search) and the kerning survives the recycle.
  codeInput: { fontFamily: Type.medium, fontSize: 26, textAlign: 'center' },
  link: { alignSelf: 'flex-start' },
});
