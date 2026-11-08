import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Intro } from '@/components/intro';
import { RowLink } from '@/components/row-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticSuccess } from '@/lib/haptics';
import { useBottomGap } from '@/hooks/use-bottom-gap';

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
  {
    label: 'The Movie Database (TMDB)',
    hint: 'Where titles, posters and cast come from',
    href: 'https://www.themoviedb.org',
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
  const bottomGap = useBottomGap();
  const c = useTheme();
  const router = useRouter();
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
      {/* No header title: the Intro is the title (ADR 0030). */}
      <Stack.Screen options={{ headerShown: true, title: '' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomGap }]}>
        <Intro title="About" body="Your build, the tour, and the policies behind the app." />

        {/* Tappable because the first thing anyone reporting a bug is asked for
            is which build they're on, and nobody wants to retype it. */}
        <Pressable
          onPress={copyBuild}
          accessibilityRole="button"
          accessibilityLabel={`WatchBuddy ${VERSION}${BUILD ? `, build ${BUILD}` : ''}`}
          accessibilityHint="Copies the build number">
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

        <View>
          <RowLink
            label="How WatchBuddy works"
            note="Take the tour again"
            onPress={() => router.push({ pathname: '/tutorial', params: { replay: '1' } })}
            accessibilityHint="Takes the tour again"
          />
          {LINKS.map(({ label: text, hint, href }) => (
            <RowLink
              key={href}
              label={text}
              note={hint}
              accessibilityRole="link"
              onPress={() =>
                openBrowserAsync(href, {
                  presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
                })
              }
            />
          ))}
        </View>

        {/* Required by TMDB's API terms. */}
        <ThemedText type="small" style={[styles.credit, { color: c.textSecondary }]}>
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // The tutorial-card measures: 24pt sides, 32 between groups.
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, gap: Spacing.five },
  buildCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.half,
    alignItems: 'center',
  },
  credit: { textAlign: 'center' },
});
