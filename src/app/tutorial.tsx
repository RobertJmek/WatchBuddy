import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOut, SlideInLeft, SlideInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol, type IconName } from '@/components/icon-symbol';
import { SwipeNav } from '@/components/swipe-nav';
import { SwipeToLogRow } from '@/components/swipe-to-log-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticSuccess, hapticTick, hapticUndo } from '@/lib/haptics';

/**
 * "How WatchBuddy works": a few cards shown once, right after onboarding's
 * profile step, and replayable from About (`?replay=1`). ADR 0028.
 *
 * The cards are a state index inside a `SwipeNav`, not a pager: the try-it
 * card holds a real `SwipeToLogRow`, and the row (10pt) has to win against the
 * card swipe (12pt) by threshold, the same rule every other screen relies on.
 * A pager would claim the drag first.
 */

type Card = { icon: IconName; title: string; body: string; demo?: true };

const CARDS: Card[] = [
  {
    icon: 'film',
    title: 'Welcome to WatchBuddy',
    body: 'Track every movie and show you watch, and see what your friends are watching.',
  },
  {
    icon: 'magnifyingglass',
    title: 'Log a watch',
    body: 'Search a title and swipe it right to log it, or open it and use the buttons. Episodes, seasons and whole series work too.',
  },
  {
    icon: 'checkmark',
    title: 'Try it',
    body: 'Swipe the row right to log it, and left to undo. Nothing here is saved.',
    demo: true,
  },
  {
    icon: 'star',
    title: 'Rate it',
    body: "Drag across 1–10 on a title's page. A first rating counts as watched, and you can add a review.",
  },
  {
    icon: 'book.closed',
    title: 'Library & Diary',
    body: 'Sort titles into Watchlist, Watching and Completed, and filter them. Your Diary keeps every watch with a date you can edit.',
  },
  {
    icon: 'person.2',
    title: 'Friends & Feed',
    body: 'Type @ in Search to find people and follow them. The Feed shows what they watch, and you can like and reply to reviews.',
  },
  {
    icon: 'hand.draw',
    title: 'Gestures & extras',
    body: 'Swipe between tabs, swipe right to go back, pull down to close a title. Your Stats live on your profile, and you can import from TV Time in Edit Profile.',
  },
];

export default function TutorialScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { replay } = useLocalSearchParams<{ replay?: string }>();
  const [index, setIndex] = useState(0);
  const [forward, setForward] = useState(true);
  const [logged, setLogged] = useState(false);

  const last = index === CARDS.length - 1;
  const card = CARDS[index];

  // A committed SwipeNav swipe ticks inside its own `fire()`; the buttons tick here.
  const next = () => {
    setForward(true);
    setIndex((i) => Math.min(i + 1, CARDS.length - 1));
  };
  const back = () => {
    setForward(false);
    setIndex((i) => Math.max(i - 1, 0));
  };

  const done = () => (replay ? router.back() : router.replace('/'));
  const finish = () => {
    hapticSuccess();
    done();
  };

  const log = () => {
    setLogged(true);
    hapticSuccess();
  };
  const undo = () => {
    setLogged(false);
    hapticUndo();
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <SwipeNav onSwipeLeft={last ? undefined : next} onSwipeRight={index > 0 ? back : undefined}>
        <View style={[styles.top, { paddingTop: insets.top + Spacing.two }]}>
          <Pressable onPress={done} hitSlop={12} accessibilityRole="button">
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              Skip
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.stage}>
          <Animated.View
            key={index}
            entering={(forward ? SlideInRight : SlideInLeft).duration(220)}
            exiting={FadeOut.duration(120)}
            style={styles.card}>
            <View style={[styles.badge, { backgroundColor: c.backgroundElement }]}>
              <IconSymbol name={card.icon} size={36} tintColor={Accent} />
            </View>
            <ThemedText type="title" style={styles.center}>
              {card.title}
            </ThemedText>
            <ThemedText style={[styles.center, { color: c.textSecondary }]}>{card.body}</ThemedText>

            {card.demo && (
              <View style={styles.demo}>
                <SwipeToLogRow
                  onLog={log}
                  logLabel="Log watch"
                  onUndo={logged ? undo : undefined}>
                  <Pressable
                    style={[styles.row, { backgroundColor: c.backgroundElement }]}
                    // The swipe's actions for a screen reader, on the row's own
                    // focusable node (ADR 0018).
                    accessibilityLabel="Your first movie, demo"
                    accessibilityActions={
                      logged
                        ? [
                            { name: 'log', label: 'Log watch' },
                            { name: 'undo', label: 'Undo' },
                          ]
                        : [{ name: 'log', label: 'Log watch' }]
                    }
                    onAccessibilityAction={({ nativeEvent }) => {
                      if (nativeEvent.actionName === 'log') log();
                      else if (nativeEvent.actionName === 'undo') undo();
                    }}>
                    <Image source={require('@/assets/images/icon.png')} style={styles.poster} />
                    <View style={styles.rowText}>
                      <ThemedText type="smallBold">Your first movie</ThemedText>
                      <ThemedText type="small" style={{ color: c.textSecondary }}>
                        {logged ? 'Logged!' : 'Movie · demo'}
                      </ThemedText>
                    </View>
                    {logged && (
                      <Pressable
                        style={styles.check}
                        hitSlop={8}
                        onPress={undo}
                        accessibilityRole="button"
                        accessibilityLabel="Undo this watch">
                        <IconSymbol name="checkmark" size={18} tintColor={AccentText} />
                      </Pressable>
                    )}
                  </Pressable>
                </SwipeToLogRow>
              </View>
            )}
          </Animated.View>
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View
            style={styles.dots}
            accessible
            accessibilityLabel={`Step ${index + 1} of ${CARDS.length}`}>
            {CARDS.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, { backgroundColor: i === index ? Accent : c.border }]}
              />
            ))}
          </View>
          <View style={styles.buttons}>
            <Pressable
              style={[styles.secondaryBtn, index === 0 && styles.hidden]}
              onPress={() => {
                hapticTick();
                back();
              }}
              disabled={index === 0}
              accessibilityRole="button"
              accessibilityElementsHidden={index === 0}
              importantForAccessibility={index === 0 ? 'no-hide-descendants' : 'auto'}>
              <ThemedText type="smallBold">Back</ThemedText>
            </Pressable>
            <Pressable
              style={styles.primaryBtn}
              onPress={
                last
                  ? finish
                  : () => {
                      hapticTick();
                      next();
                    }
              }
              accessibilityRole="button">
              <ThemedText style={styles.primaryText}>{last ? 'Get started' : 'Next'}</ThemedText>
            </Pressable>
          </View>
        </View>
      </SwipeNav>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { alignItems: 'flex-end', paddingHorizontal: Spacing.four },
  stage: { flex: 1, overflow: 'hidden' },
  card: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  badge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  center: { textAlign: 'center' },
  demo: { alignSelf: 'stretch', marginTop: Spacing.three },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
    padding: Spacing.two,
    borderRadius: Spacing.three,
  },
  poster: { width: 52, height: 78, borderRadius: 4 },
  rowText: { flex: 1, gap: Spacing.half },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: { paddingHorizontal: Spacing.three, gap: Spacing.three },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4 },
  buttons: { flexDirection: 'row', gap: Spacing.three },
  secondaryBtn: {
    flex: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  hidden: { opacity: 0 },
  primaryBtn: {
    flex: 2,
    backgroundColor: Accent,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  primaryText: { color: AccentText, fontWeight: '700', fontSize: 16 },
});
