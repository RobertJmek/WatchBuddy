import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { IconSymbol } from '@/components/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticSuccess } from '@/lib/haptics';

/**
 * Version, build and the policy pages — everything you go looking for when
 * something is wrong, and nothing you need while using the app. Reached from
 * the ⓘ on Profile.
 */

const DOCS = 'https://robertjmek.github.io/WatchBuddy';

const LINKS: { label: string; hint: string; href: string }[] = [
  {
    label: 'Privacy Policy',
    hint: 'What the app stores and what it never does',
    href: `${DOCS}/privacy`,
  },
  {
    label: 'Support',
    hint: 'How to reach us about a bug or a question',
    href: `${DOCS}/support`,
  },
  {
    label: 'Delete your account',
    hint: 'What gets erased, and how to ask for it',
    href: `${DOCS}/delete-account`,
  },
  {
    label: 'Safety standards',
    hint: 'Our stance on child safety and abuse',
    href: `${DOCS}/safety-standards`,
  },
  {
    label: 'Source code',
    hint: 'WatchBuddy is open source on GitHub',
    href: 'https://github.com/RobertJmek/WatchBuddy',
  },
];

/**
 * Read from the build's embedded manifest, so it reports the binary you're
 * actually running — the whole point is telling "did my install update?" apart
 * from "did the change not ship?" without a cable or Settings → Apps.
 */
const VERSION = Constants.expoConfig?.version ?? '—';
const BUILD = Constants.expoConfig?.android?.versionCode;

export default function AboutScreen() {
  const c = useTheme();
  const [copied, setCopied] = useState(false);

  const label = [
    `WatchBuddy ${VERSION}`,
    BUILD ? `build ${BUILD}` : null,
    Platform.OS,
  ]
    .filter(Boolean)
    .join(' · ');

  async function copyBuild() {
    await Clipboard.setStringAsync(label);
    hapticSuccess();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'About' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Tappable because the first thing anyone reporting a bug is asked for
            is which build they're on, and nobody wants to retype it. */}
        <Pressable onPress={copyBuild}>
          <ThemedView type="backgroundElement" style={styles.buildCard}>
            <ThemedText type="subtitle">WatchBuddy {VERSION}</ThemedText>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              {BUILD ? `Build ${BUILD} · ${Platform.OS}` : Platform.OS}
            </ThemedText>
            <ThemedText type="meta" style={{ color: copied ? c.tint : c.textSecondary }}>
              {copied ? 'Copied' : 'Tap to copy'}
            </ThemedText>
          </ThemedView>
        </Pressable>

        <View style={styles.links}>
          {LINKS.map(({ label: text, hint, href }) => (
            <Pressable
              key={href}
              style={[styles.link, { borderBottomColor: c.border }]}
              onPress={() =>
                openBrowserAsync(href, {
                  presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
                })
              }>
              <View style={styles.linkText}>
                <ThemedText type="subtitle">{text}</ThemedText>
                <ThemedText type="small" style={{ color: c.textSecondary }}>
                  {hint}
                </ThemedText>
              </View>
              <IconSymbol name="chevron.right" size={18} tintColor={c.textSecondary} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four },
  buildCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.half,
    alignItems: 'center',
  },
  links: { gap: 0 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  linkText: { flex: 1, gap: Spacing.half },
});
