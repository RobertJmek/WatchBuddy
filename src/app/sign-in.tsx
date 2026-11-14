import * as AppleAuthentication from 'expo-apple-authentication';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Pressable } from '@/components/pressable';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { hapticFailure } from '@/lib/haptics';

const CODE_LENGTH = 6;
/** The server sends one code a minute to an address; the button waits as long. */
const RESEND_AFTER = 60;

/**
 * The code as six cells. One real field lies over them, invisible, so typing,
 * paste and the keyboard's code suggestion all work as in any text field; the
 * cells only draw what it holds.
 */
function CodeCells({
  value,
  onChange,
  invalid,
  editable,
}: {
  value: string;
  onChange: (code: string) => void;
  invalid: boolean;
  editable: boolean;
}) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.cells}>
      {Array.from({ length: CODE_LENGTH }, (_, i) => {
        const active = focused && i === Math.min(value.length, CODE_LENGTH - 1);
        return (
          <View
            key={i}
            style={[
              styles.cell,
              {
                backgroundColor: c.backgroundElement,
                borderColor: invalid ? c.danger : active ? c.tint : 'transparent',
              },
            ]}>
            <ThemedText style={styles.digit}>{value[i] ?? ''}</ThemedText>
          </View>
        );
      })}
      <TextInput
        style={styles.cellsInput}
        accessibilityLabel={`${CODE_LENGTH}-digit code`}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus
        caretHidden
        selectionColor="transparent"
        value={value}
        editable={editable}
        // Not maxLength: a pasted "123 456" has to arrive whole to be cleaned.
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
}

/** What went wrong, right under the field; a screen reader hears it arrive. */
function Problem({ text }: { text: string }) {
  return (
    <ThemedText
      type="small"
      themeColor="danger"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite">
      {text}
    </ThemedText>
  );
}

export default function SignInScreen() {
  const { sendCode, verifyCode, signInWithProvider, signInWithApple } = useAuth();
  const c = useTheme();
  const isDark = useColorScheme() === 'dark';

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Shown under the field it is about, not in an alert over it. */
  const [problem, setProblem] = useState<string | null>(null);
  /** Seconds until another code can be asked for. */
  const [wait, setWait] = useState(0);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const tick = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(tick);
  }, [wait]);

  async function handleSend() {
    if (!email.includes('@')) {
      setProblem('Enter a valid email address.');
      return;
    }
    setProblem(null);
    setBusy(true);
    const { error } = await sendCode(email);
    setBusy(false);
    if (error) {
      setProblem("We couldn't send the code. Try again in a minute.");
      return;
    }
    setCode('');
    setCodeSent(true);
    setWait(RESEND_AFTER);
  }

  async function handleVerify(entered: string) {
    if (entered.length < CODE_LENGTH) {
      setProblem(`Enter all ${CODE_LENGTH} digits.`);
      return;
    }
    setProblem(null);
    setBusy(true);
    const { error } = await verifyCode(email, entered);
    setBusy(false);
    if (!error) return;
    hapticFailure();
    // The hidden field can only be edited from its end, so a wrong code is
    // cleared rather than left to be backspaced through.
    setCode('');
    setProblem("That code didn't work. Check it, or get a new one.");
  }

  function handleCode(next: string) {
    setCode(next);
    setProblem(null);
    // The last digit sends it; the button stays for a code that needs a retry.
    if (next.length === CODE_LENGTH) handleVerify(next);
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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container}>
        {/* Scrolls so the button under the code field stays reachable: iOS's
            number pad has no Return key to put the keyboard away. */}
        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          bottomOffset={Spacing.three}>
        {!codeSent ? (
          <>
            <Image
              style={[
                styles.logo,
                { borderColor: c.border },
                // Light: a drop shadow lifts the tile off the white page. Dark:
                // the near-black tile vanishes into the page, so a warm glow
                // defines it instead.
                isDark
                  ? { shadowColor: c.glow, shadowOpacity: 0.32, shadowRadius: 28 }
                  : { shadowColor: '#1A1714', shadowOpacity: 0.18, shadowRadius: 24 },
              ]}
              source={require('@/assets/images/icon.png')}
              contentFit="contain"
            />
            <View style={styles.head}>
              <ThemedText type="title" style={styles.center}>
                WatchBuddy
              </ThemedText>
              <ThemedText style={[styles.body, styles.center]} themeColor="textSecondary">
                Track everything you watch.
              </ThemedText>
            </View>

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
                <ThemedText type="label">Continue with Apple</ThemedText>
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
              <ThemedText type="label">Continue with Google</ThemedText>
            </Pressable>

            <View style={styles.divider}>
              <View style={[styles.rule, { backgroundColor: c.border }]} />
              <ThemedText type="small" themeColor="textSecondary">
                or
              </ThemedText>
              <View style={[styles.rule, { backgroundColor: c.border }]} />
            </View>

            <View style={styles.field}>
              <ThemedText type="label">Email</ThemedText>
              <TextInput
                style={[
                  styles.input,
                  { color: c.text, backgroundColor: c.backgroundElement },
                ]}
                accessibilityLabel="Email"
                placeholder="you@example.com"
                placeholderTextColor={c.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                keyboardType="email-address"
                returnKeyType="send"
                onSubmitEditing={handleSend}
                value={email}
                editable={!busy}
                onChangeText={(t) => {
                  setEmail(t);
                  setProblem(null);
                }}
              />
              {problem && <Problem text={problem} />}
            </View>
            <Button title="Send code" onPress={handleSend} loading={busy} />
          </>
        ) : (
          <>
            <View style={styles.head}>
              <ThemedText
                type="title"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}>
                Enter your code
              </ThemedText>
              <ThemedText style={styles.body} themeColor="textSecondary">
                We sent a {CODE_LENGTH}-digit code to{' '}
                <ThemedText style={[styles.body, styles.address]}>{email.trim()}</ThemedText>
              </ThemedText>
            </View>

            <View style={styles.field}>
              <CodeCells
                value={code}
                onChange={handleCode}
                invalid={!!problem}
                editable={!busy}
              />
              {problem && <Problem text={problem} />}
            </View>
            <Button title="Verify" onPress={() => handleVerify(code)} loading={busy} />

            <View style={styles.links}>
              <Pressable
                style={styles.linkBtn}
                onPress={handleSend}
                disabled={busy || wait > 0}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || wait > 0 }}>
                <ThemedText
                  type="smallBold"
                  themeColor={wait > 0 ? 'textSecondary' : 'tint'}>
                  {wait > 0
                    ? `Resend code in 0:${String(wait).padStart(2, '0')}`
                    : 'Resend code'}
                </ThemedText>
              </Pressable>
              <Pressable
                style={styles.linkBtn}
                onPress={() => {
                  setCodeSent(false);
                  setCode('');
                  setProblem(null);
                }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}>
                <ThemedText type="smallBold" themeColor="tint">
                  Use a different email
                </ThemedText>
              </Pressable>
            </View>
          </>
        )}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flexGrow: 1,
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
  head: { gap: Spacing.two, marginBottom: Spacing.three },
  center: { textAlign: 'center' },
  body: { fontSize: 17, lineHeight: 26 },
  // The address the code went to, at full contrast inside the muted line.
  address: { fontFamily: Type.semibold },
  field: { gap: Spacing.two },
  input: {
    fontFamily: Type.body,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 17,
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
  divider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  cells: { flexDirection: 'row', gap: Spacing.two },
  cell: {
    flex: 1,
    height: 60,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: { fontFamily: Type.semibold, fontSize: 26, lineHeight: 32 },
  // Over the cells, so a tap anywhere on them focuses it. Its own text is
  // never seen. No letterSpacing: iOS recycles this native view into later
  // TextInputs (Search) and the kerning survives the recycle.
  cellsInput: { ...StyleSheet.absoluteFill, color: 'transparent', fontSize: 1 },
  links: { alignItems: 'center' },
  // 44pt targets for the two text actions.
  linkBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three },
});
