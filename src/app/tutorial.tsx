import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  SlideInLeft,
  SlideInRight,
  useReducedMotion,
} from 'react-native-reanimated';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol, type IconName } from '@/components/icon-symbol';
import { KeyboardDismissButton } from '@/components/keyboard-dismiss-button';
import { LibraryStatusBar } from '@/components/library-status-bar';
import { PressScale } from '@/components/press-scale';
import { RatingBar } from '@/components/rating-bar';
import { SearchRow } from '@/components/search-row';
import { SwipeNav } from '@/components/swipe-nav';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UserRow } from '@/components/user-row';
import { Accent, AccentText, Danger, Glow, Hero, PlaceholderBg, Spacing, Type } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { hapticSuccess, hapticTick } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import { entityTypeFor, getRating } from '@/lib/ratings';
import { searchUsers } from '@/lib/social';
import {
  imageUrl,
  searchTitles,
  titleQueryOptions,
  type SearchResult,
  type TitleRow,
} from '@/lib/tmdb';
import { itemKey, useSearchLog } from '@/lib/use-search-log';

/**
 * "How WatchBuddy works": five cards, each with one real thing to do, shown
 * once right after onboarding's profile step and replayable from About
 * (`?replay=1`). Everything here writes for real (log, rate, status, follow)
 * through the same components the app uses. ADR 0028.
 *
 * Layout follows one rule: tight inside a group, wide between groups (8pt
 * grid). Each card is a title, a line or two of why, then one or two steps,
 * each with its instruction right above the control it is about.
 *
 * The cards are a state index inside a `SwipeNav`, not a pager: the controls
 * on them (a swipe-to-log row at 10pt, the rating drag at ~6pt, a native
 * scroll at 8dp) must win the drag against the card swipe (12pt) by threshold,
 * the same rule every other screen relies on.
 */

/** The title the later cards use when the user picks nothing on the first one. */
const DEFAULT_TITLE: SearchResult = {
  tmdb_id: 1401459,
  media_type: 'movie',
  title: 'Fjord',
  overview: '',
  poster_path: null,
  release_date: '2026-06-13',
  vote_average: null,
};

/** Suggested on the friends card while nothing is typed. */
const SUGGESTED_USERNAME = 'watchbuddy';

const CARD_COUNT = 5;
const MIN_CHARS = 3;
const DEBOUNCE_MS = 500;

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Card content rises in one group after another. */
const rise = (step: number) =>
  FadeInDown.duration(340)
    .delay(40 + step * 80)
    .easing(EASE_OUT);
const layout = LinearTransition.duration(220).easing(EASE_OUT);

export default function TutorialScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { replay } = useLocalSearchParams<{ replay?: string }>();
  const [index, setIndex] = useState(0);
  const [forward, setForward] = useState(true);

  // Lifted out of the cards, which unmount on every change.
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [people, setPeople] = useState('');
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const { logged, logItem, undoItem } = useSearchLog();

  // The default title's poster comes from the same read-through the title page uses.
  const defaultQ = useQuery(titleQueryOptions(DEFAULT_TITLE.tmdb_id, DEFAULT_TITLE.media_type));
  const fallback: SearchResult = {
    ...DEFAULT_TITLE,
    poster_path: defaultQ.data?.title.poster_path ?? null,
  };
  const chosen = picked ?? fallback;
  // Undo is mentioned only once there is something to undo, and as an aside:
  // asking for it would take the title back out of the Library and Diary.
  const pickedLogged = picked != null && logged.has(itemKey(picked));

  const pick = (item: SearchResult) => {
    Keyboard.dismiss();
    hapticTick();
    setPicked(item);
  };

  const last = index === CARD_COUNT - 1;

  // A committed SwipeNav swipe ticks inside its own `fire()`; the buttons tick here.
  const go = (step: 1 | -1) => {
    Keyboard.dismiss();
    setForward(step > 0);
    setIndex((i) => Math.min(Math.max(i + step, 0), CARD_COUNT - 1));
  };
  const next = () => {
    hapticTick();
    go(1);
  };
  const done = () => {
    Keyboard.dismiss();
    if (replay) router.back();
    else router.replace('/');
  };

  // Leaving the screen any way at all (a tapped profile or title, Skip) takes
  // the keyboard down with it, so it never stays up over the next screen.
  useFocusEffect(useCallback(() => () => Keyboard.dismiss(), []));

  const field = { backgroundColor: c.backgroundElement };
  const fieldText = [styles.fieldInput, { color: c.text }];

  const cards = [
    <Card
      key="log"
      title="Log a watch"
      body="Keep track of every movie and show you watch.">
      <Step n={1} label="Search for something you've seen">
        <View style={[styles.field, field]}>
          <IconSymbol name="magnifyingglass" size={18} tintColor={c.textSecondary} />
          <TextInput
            style={fieldText}
            placeholder="Movie or show"
            placeholderTextColor={c.textSecondary}
            returnKeyType="search"
            autoCorrect={false}
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              setSubmitted('');
            }}
            onSubmitEditing={() => setSubmitted(query.trim())}
          />
        </View>
        <SearchPicks query={query} submitted={submitted} picked={picked} onPick={pick} />
      </Step>
      <Step
        n={2}
        label={pickedLogged ? 'Logged' : 'Swipe it right to log it'}
        note={pickedLogged ? 'Changed your mind? Swipe left or tap ✓ to undo.' : undefined}>
        {picked ? (
          <SwipeTry
            item={picked}
            logged={logged}
            onLog={logItem}
            onUndo={undoItem}
            onNext={next}
          />
        ) : (
          <View style={[styles.empty, { borderColor: c.border }]}>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              Choose a title above.
            </ThemedText>
            <Pressable onPress={() => pick(fallback)} hitSlop={8} accessibilityRole="button">
              <ThemedText type="smallBold" style={{ color: Accent }}>
                Or use {DEFAULT_TITLE.title}
              </ThemedText>
            </Pressable>
          </View>
        )}
      </Step>
    </Card>,
    <Card
      key="rate"
      title="Rate it"
      body="Rate titles from 1 to 10. Your ratings feed your stats.">
      <Step label="Drag across the numbers and let go" note="Rating a title also logs it as watched.">
        <TitleControl title={chosen} control="rating" />
      </Step>
    </Card>,
    <Card
      key="library"
      title="Your library"
      body="Sort titles by status. Every watch also goes into your Diary.">
      <Step label="Tap a status" note="Every title's page has these.">
        <TitleControl title={chosen} control="status" />
      </Step>
    </Card>,
    <Card
      key="friends"
      title="Find friends"
      body="Follow friends to see what they watch and rate.">
      <Step label="Search for a username, then tap Follow" note="In Search, type @ before a name.">
        <View style={[styles.field, field]}>
          <ThemedText style={{ color: c.textSecondary }}>@</ThemedText>
          <TextInput
            style={fieldText}
            placeholder="username"
            placeholderTextColor={c.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            value={people}
            onChangeText={setPeople}
          />
        </View>
        <PeopleResults text={people} />
      </Step>
    </Card>,
    <Card key="gestures" title="Swipe around" body="Most of WatchBuddy works with swipes.">
      <Step
        label="Swipe the box to switch tabs"
        note="Swipe right to go back. Pull a title down to close it.">
        <TabDemo />
      </Step>
    </Card>,
  ];

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <SwipeNav
        onSwipeLeft={last ? undefined : () => go(1)}
        onSwipeRight={index > 0 ? () => go(-1) : undefined}>
        <View style={[styles.top, { paddingTop: insets.top + Spacing.two }]}>
          <Pressable onPress={done} hitSlop={12} accessibilityRole="button">
            <ThemedText type="smallBold" style={{ color: c.textSecondary }}>
              Skip
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.stage}>
          <Animated.View
            key={index}
            entering={(forward ? SlideInRight : SlideInLeft).duration(260).easing(EASE_OUT)}
            exiting={FadeOut.duration(120)}
            style={StyleSheet.absoluteFill}>
            {cards[index]}
          </Animated.View>
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View
            style={styles.dots}
            accessible
            accessibilityLabel={`Step ${index + 1} of ${CARD_COUNT}`}>
            {cards.map((card, i) => (
              <Animated.View
                key={card.key}
                style={[
                  styles.dot,
                  {
                    width: i === index ? 22 : 8,
                    backgroundColor: i === index ? Accent : c.border,
                    transitionProperty: ['width', 'backgroundColor'],
                    transitionDuration: 220,
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.buttons}>
            {index > 0 && (
              <PressScale
                style={[styles.button, styles.secondaryBtn, { borderColor: c.text }]}
                onPress={() => {
                  hapticTick();
                  go(-1);
                }}
                accessibilityRole="button"
                accessibilityLabel="Back">
                <ThemedText style={styles.buttonText}>Back</ThemedText>
              </PressScale>
            )}
            <PressScale
              style={[styles.button, styles.primaryBtn]}
              onPress={() => {
                if (!last) return next();
                hapticSuccess();
                done();
              }}
              accessibilityRole="button"
              accessibilityLabel={last ? 'Get started' : 'Next'}>
              <ThemedText style={[styles.buttonText, { color: AccentText }]}>
                {last ? 'Get started' : 'Next'}
              </ThemedText>
            </PressScale>
          </View>
        </View>
      </SwipeNav>
      <KeyboardDismissButton />
    </ThemedView>
  );
}

function Card({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  const c = useTheme();
  return (
    // Same scroll container as sign-in and the title page: it keeps the focused
    // field above the keyboard, with room left for the hide-keyboard button.
    <KeyboardAwareScrollView
      contentContainerStyle={styles.card}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      bottomOffset={Spacing.six}>
      <Animated.View entering={rise(0)} style={styles.intro}>
        {/* One line on every phone: the type shrinks before it wraps. */}
        <ThemedText type="title" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {title}
        </ThemedText>
        <ThemedText style={[styles.body, { color: c.textSecondary }]}>{body}</ThemedText>
      </Animated.View>
      <Animated.View entering={rise(1)} style={styles.steps}>
        {children}
      </Animated.View>
    </KeyboardAwareScrollView>
  );
}

/** One instruction and the control it is about. `n` numbers it when a card has two. */
function Step({
  n,
  label,
  note,
  children,
}: {
  n?: number;
  label: string;
  note?: string;
  children: ReactNode;
}) {
  const c = useTheme();
  return (
    <Animated.View layout={layout} style={styles.step}>
      <View style={styles.stepHead}>
        <View style={styles.stepLabelRow}>
          {n != null && (
            <View style={styles.stepNum}>
              <ThemedText style={styles.stepNumText}>{n}</ThemedText>
            </View>
          )}
          <Animated.View key={label} entering={FadeIn.duration(220)} style={styles.stepLabelWrap}>
            <ThemedText style={styles.stepLabel}>{label}</ThemedText>
          </Animated.View>
        </View>
        {note && (
          <ThemedText
            type="small"
            style={[n != null && styles.noteIndent, { color: c.textSecondary }]}>
            {note}
          </ThemedText>
        )}
      </View>
      {children}
    </Animated.View>
  );
}

/**
 * True once `value` differs from the first value it settled on: an animated
 * hint steps aside once the user has done what it shows. (Setting state during
 * render is React's pattern for remembering a prior value.)
 */
function useChanged<T>(value: T | undefined) {
  const [first, setFirst] = useState<{ v: T } | null>(null);
  if (first === null && value !== undefined) setFirst({ v: value });
  return first !== null && value !== undefined && value !== first.v;
}

/**
 * Step 1: search, and tap a result to choose it. Choosing does not log; that
 * is step 2's swipe, kept apart so the search is something the user does, not
 * something they scroll past. Same term rule as Search (ADR 0020): live from 3
 * characters, any length on the keyboard's Search key.
 */
function SearchPicks({
  query,
  submitted,
  picked,
  onPick,
}: {
  query: string;
  submitted: string;
  picked: SearchResult | null;
  onPick: (item: SearchResult) => void;
}) {
  const c = useTheme();
  const debounced = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const term = submitted || (debounced.length >= MIN_CHARS ? debounced : '');
  const search = useQuery({
    queryKey: keys.search(term),
    queryFn: () => searchTitles(term),
    enabled: !!term,
    placeholderData: keepPreviousData,
  });

  if (!query.trim()) return null;
  if (search.isError)
    return (
      <ThemedText type="small" style={{ color: c.textSecondary }}>
        Search failed. Try again.
      </ThemedText>
    );
  if (!search.data) return term ? <ActivityIndicator style={styles.spinner} /> : null;
  if (search.data.length === 0)
    return (
      <ThemedText type="small" style={{ color: c.textSecondary }}>
        Nothing found.
      </ThemedText>
    );

  return (
    <View style={styles.picks}>
      {search.data.slice(0, 4).map((item, i) => {
        const on = picked != null && itemKey(picked) === itemKey(item);
        const poster = imageUrl(item.poster_path, 'w92');
        return (
          <Animated.View key={itemKey(item)} entering={FadeIn.duration(200).delay(i * 40)}>
            <Pressable
              onPress={() => onPick(item)}
              style={({ pressed }) => [
                styles.pick,
                { backgroundColor: on ? c.backgroundSelected : 'transparent' },
                pressed && styles.pressed,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${item.title}, ${item.media_type === 'tv' ? 'TV' : 'movie'}`}>
              <Image
                style={styles.pickPoster}
                source={poster ? { uri: poster } : undefined}
                contentFit="cover"
              />
              <View style={styles.pickText}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {item.title}
                </ThemedText>
                <ThemedText type="small" style={{ color: c.textSecondary }}>
                  {item.media_type === 'tv' ? 'TV' : 'Movie'}
                  {item.release_date ? ` · ${item.release_date.slice(0, 4)}` : ''}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.radio,
                  { borderColor: on ? Accent : c.border },
                  on && styles.radioOn,
                ]}>
                {on && <IconSymbol name="checkmark" size={12} tintColor={AccentText} />}
              </View>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

const PEEK = 104;

/**
 * Shows what a swipe does before the user tries it: the row slides aside and
 * uncovers the same layer the real swipe reveals, then settles back.
 * `log` loops (teal, to the right) until the title is logged; `undo` plays
 * once (red, to the left) right after, so undo is shown without being pushed.
 * The same element animates in both modes, so the row is never remounted
 * under the swipe's own spring.
 */
function Peek({ mode, children }: { mode: 'log' | 'undo'; children: ReactNode }) {
  const reduced = useReducedMotion();
  const x = mode === 'log' ? PEEK : -PEEK;
  return (
    <View style={styles.peek}>
      {mode === 'log' ? (
        <View style={[styles.peekUnder, styles.peekLog]}>
          <IconSymbol name="checkmark" size={20} tintColor={AccentText} />
          <ThemedText style={styles.peekText}>Log</ThemedText>
        </View>
      ) : (
        <View style={[styles.peekUnder, styles.peekUndo]}>
          <ThemedText style={styles.peekText}>Undo</ThemedText>
          <IconSymbol name="arrow.uturn" size={18} tintColor={AccentText} />
        </View>
      )}
      <Animated.View
        style={
          reduced
            ? undefined
            : {
                animationName: {
                  '0%': { transform: [{ translateX: 0 }] },
                  '35%': { transform: [{ translateX: 0 }] },
                  '55%': { transform: [{ translateX: x }] },
                  '70%': { transform: [{ translateX: x }] },
                  '88%': { transform: [{ translateX: 0 }] },
                  '100%': { transform: [{ translateX: 0 }] },
                },
                animationDuration: 2800,
                // After a log, wait for the swipe's own close spring first.
                animationDelay: mode === 'undo' ? 400 : 0,
                animationIterationCount: mode === 'log' ? 'infinite' : 1,
                animationTimingFunction: 'ease-in-out',
              }
        }>
        {children}
      </Animated.View>
    </View>
  );
}

/** Step 2: the chosen title as the real swipe-to-log row. */
function SwipeTry({
  item,
  logged,
  onLog,
  onUndo,
  onNext,
}: {
  item: SearchResult;
  logged: ReturnType<typeof useSearchLog>['logged'];
  onLog: (item: SearchResult) => void;
  onUndo: (item: SearchResult) => void;
  onNext: () => void;
}) {
  const c = useTheme();
  const router = useRouter();
  const key = itemKey(item);
  const isLogged = logged.has(key);
  const row = (
    <SearchRow
      item={item}
      bg={c.backgroundElement}
      router={router}
      logged={isLogged}
      pending={logged.get(key)?.some((e) => e.pending) ?? false}
      onLog={onLog}
      onUndo={onUndo}
    />
  );
  return (
    <Animated.View
      key={key}
      entering={FadeInDown.duration(260).easing(EASE_OUT)}
      style={styles.picks}>
      <Peek mode={isLogged ? 'undo' : 'log'}>{row}</Peek>
      {isLogged && (
        <Animated.View entering={FadeInDown.duration(260).easing(EASE_OUT)}>
          <Pressable
            style={styles.success}
            onPress={onNext}
            accessibilityRole="button"
            accessibilityLabel="Next: rate it">
            <ThemedText type="smallBold" style={{ color: Accent }}>
              Next: rate it
            </ThemedText>
            <IconSymbol name="chevron.right" size={16} tintColor={Accent} />
          </Pressable>
        </Animated.View>
      )}
    </Animated.View>
  );
}

/**
 * A miniature of the title page around the real control: the same letterboxed
 * backdrop, poster, Bodoni title and meta line, so the user recognises where
 * rating and statuses live in the app.
 */
function TitleControl({ title, control }: { title: SearchResult; control: 'rating' | 'status' }) {
  const c = useTheme();
  const q = useQuery(titleQueryOptions(title.tmdb_id, title.media_type));
  const row = q.data?.title;
  const poster = imageUrl(row?.poster_path ?? title.poster_path, 'w185');
  const backdrop = imageUrl(row?.backdrop_path ?? null, 'w780') ?? poster;
  const year = (row?.release_date ?? title.release_date)?.slice(0, 4);
  const length =
    row?.media_type === 'tv'
      ? row.number_of_seasons != null
        ? `${row.number_of_seasons} Season${row.number_of_seasons === 1 ? '' : 's'}`
        : null
      : row?.runtime
        ? `${row.runtime} Min`
        : null;

  return (
    <View style={[styles.page, { borderColor: c.border, backgroundColor: c.background }]}>
      <View style={styles.pageHero}>
        <Image
          style={StyleSheet.absoluteFill}
          source={backdrop ? { uri: backdrop } : undefined}
          contentFit="cover"
          transition={200}
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.5)', c.background]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.pageLetterbox} />
        <View style={styles.pageHeader}>
          <Image
            style={styles.pagePoster}
            source={poster ? { uri: poster } : undefined}
            contentFit="cover"
            transition={150}
          />
          <View style={styles.pageHeaderText}>
            <Text style={styles.pageEyebrow}>{title.media_type === 'tv' ? 'TV Series' : 'Film'}</Text>
            <Text style={styles.pageTitle} numberOfLines={2}>
              {title.title}
            </Text>
            <Text style={styles.pageMeta}>{[year, length].filter(Boolean).join('  ·  ')}</Text>
          </View>
        </View>
      </View>
      <View style={styles.pageBody}>
        {row ? (
          control === 'rating' ? (
            <RateBlock row={row} />
          ) : (
            <LibraryStatusBar titleId={row.id} tmdbId={row.tmdb_id} mediaType={row.media_type} />
          )
        ) : q.isError ? (
          <ThemedText type="small" style={{ color: c.textSecondary }}>
            Couldn&apos;t load this title. You can skip ahead.
          </ThemedText>
        ) : (
          <ActivityIndicator style={styles.spinner} />
        )}
      </View>
    </View>
  );
}

function RateBlock({ row }: { row: TitleRow }) {
  // The same query the rating bar reads, so this shares its request and cache.
  const q = useQuery({
    queryKey: keys.myRating(row.id),
    queryFn: () => getRating(entityTypeFor(row.media_type), row.id),
  });
  const rated = useChanged(q.data === undefined ? undefined : (q.data?.value ?? null));
  const reduced = useReducedMotion();
  return (
    <View>
      <RatingBar titleId={row.id} tmdbId={row.tmdb_id} mediaType={row.media_type} />
      {/* A ghost fingertip gliding over the real scale until the first rating.
          Its band sits where RatingBar draws the scale: under the "Your rating"
          label (16pt line + 8pt gap), one 38pt row of chips. Move it if that
          layout changes. */}
      {!rated && !reduced && (
        <Animated.View
          pointerEvents="none"
          entering={FadeIn.duration(250)}
          exiting={FadeOut.duration(150)}
          style={styles.ghostBand}>
          <Animated.View
            style={[
              styles.ghostFinger,
              {
                animationName: {
                  '0%': { left: '0%', opacity: 0, transform: [{ scale: 0.7 }] },
                  '12%': { opacity: 1, transform: [{ scale: 1 }] },
                  '70%': { left: '62%', opacity: 1, transform: [{ scale: 1 }] },
                  '85%': { left: '62%', opacity: 0, transform: [{ scale: 1.3 }] },
                  '100%': { left: '62%', opacity: 0 },
                },
                animationDuration: 2200,
                animationIterationCount: 'infinite',
                animationTimingFunction: 'ease-in-out',
              },
            ]}
          />
        </Animated.View>
      )}
    </View>
  );
}

/** People search with the real Follow rows; a suggested account while it's empty. */
function PeopleResults({ text }: { text: string }) {
  const c = useTheme();
  const typed = useDebouncedValue(text.trim().replace(/^@/, ''), DEBOUNCE_MS);
  const term = typed || SUGGESTED_USERNAME;
  const q = useQuery({
    queryKey: keys.userSearch(term),
    queryFn: () => searchUsers(term),
    placeholderData: keepPreviousData,
  });
  const users = typed
    ? (q.data ?? []).slice(0, 4)
    : (q.data ?? []).filter((u) => u.username === SUGGESTED_USERNAME);

  return (
    <View style={styles.picks}>
      {!typed && users.length > 0 && (
        <ThemedText type="small" style={{ color: c.textSecondary }}>
          Suggested
        </ThemedText>
      )}
      {typed && q.data?.length === 0 && (
        <ThemedText type="small" style={{ color: c.textSecondary }}>
          No one by that name.
        </ThemedText>
      )}
      {users.map((u) => (
        <UserRow key={u.id} user={u} />
      ))}
    </View>
  );
}

const DEMO_TABS: { label: string; icon: IconName; hint: string }[] = [
  { label: 'Feed', icon: 'rectangle.stack.fill', hint: 'What your friends are watching' },
  { label: 'Library', icon: 'film', hint: 'Everything you track' },
  { label: 'Search', icon: 'magnifyingglass', hint: 'Find titles and people' },
  { label: 'Profile', icon: 'person.crop.circle', hint: 'Your diary, ratings and stats' },
];

/**
 * A miniature of the tab pager: a paging ScrollView, which claims a horizontal
 * drag at 8dp, before the card swipe's 12pt. A ghost fingertip sweeps across
 * it until the first swipe.
 */
function TabDemo() {
  const c = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const [moved, setMoved] = useState(false);
  const [scroller, setScroller] = useState<ScrollView | null>(null);

  const show = (p: number) => {
    if (p !== page) hapticTick();
    setPage(p);
    if (p !== 0) setMoved(true);
  };

  return (
    <View
      style={[styles.demoBox, { borderColor: c.border, backgroundColor: c.backgroundElement }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={setScroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => show(Math.round(e.nativeEvent.contentOffset.x / (width || 1)))}>
        {DEMO_TABS.map((t) => (
          <View key={t.label} style={[styles.demoPage, { width }]}>
            <IconSymbol name={t.icon} size={30} tintColor={Accent} />
            <ThemedText type="subtitle">{t.label}</ThemedText>
            <ThemedText type="small" style={[styles.center, { color: c.textSecondary }]}>
              {t.hint}
            </ThemedText>
          </View>
        ))}
      </ScrollView>
      {!moved && !reduced && (
        <Animated.View
          pointerEvents="none"
          exiting={FadeOut.duration(150)}
          style={styles.demoGhostBand}>
          <Animated.View
            style={[
              styles.ghostFinger,
              {
                animationName: {
                  '0%': { left: '70%', opacity: 0 },
                  '15%': { opacity: 1 },
                  '70%': { left: '25%', opacity: 1 },
                  '85%': { left: '25%', opacity: 0 },
                  '100%': { left: '25%', opacity: 0 },
                },
                animationDuration: 1800,
                animationIterationCount: 'infinite',
                animationTimingFunction: 'ease-in-out',
              },
            ]}
          />
        </Animated.View>
      )}
      <View style={[styles.demoBar, { borderTopColor: c.border }]}>
        {DEMO_TABS.map((t, i) => {
          const on = i === page;
          return (
            <Pressable
              key={t.label}
              style={styles.demoTab}
              onPress={() => {
                scroller?.scrollTo({ x: i * width, animated: true });
                show(i);
              }}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: on }}>
              <IconSymbol name={t.icon} size={18} tintColor={on ? Accent : c.textSecondary} />
              <ThemedText type="small" style={{ color: on ? Accent : c.textSecondary }}>
                {t.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { alignItems: 'flex-end', paddingHorizontal: Spacing.four },
  stage: { flex: 1, overflow: 'hidden' },
  // 8pt grid: 12 inside a group, 32 between groups.
  card: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
    gap: Spacing.five,
  },
  intro: { gap: 12 },
  body: { fontSize: 17, lineHeight: 26 },
  steps: { gap: Spacing.five },
  step: { gap: 12 },
  stepHead: { gap: Spacing.one },
  stepLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { color: AccentText, fontFamily: Type.semibold, fontSize: 13, lineHeight: 16 },
  stepLabelWrap: { flexShrink: 1 },
  stepLabel: { fontFamily: Type.semibold, fontSize: 17, lineHeight: 24 },
  noteIndent: { marginLeft: 34 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  fieldInput: { flex: 1, fontFamily: Type.body, fontSize: 16, paddingVertical: 14 },
  spinner: { alignSelf: 'flex-start', marginVertical: Spacing.two },
  picks: { gap: Spacing.two },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: Spacing.two,
    borderRadius: 12,
  },
  pressed: { opacity: 0.6 },
  pickPoster: { width: 36, height: 54, borderRadius: 4, backgroundColor: PlaceholderBg },
  pickText: { flex: 1, gap: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: Accent },
  empty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    gap: Spacing.two,
  },
  peek: { borderRadius: Spacing.three, overflow: 'hidden' },
  peekUnder: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  peekLog: { backgroundColor: Accent, justifyContent: 'flex-start' },
  peekUndo: { backgroundColor: Danger, justifyContent: 'flex-end' },
  peekText: { color: AccentText, fontWeight: '700' },
  success: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
  },
  page: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, overflow: 'hidden' },
  pageHero: { height: 176, justifyContent: 'flex-end', backgroundColor: Hero.letterbox },
  pageLetterbox: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 14,
    backgroundColor: Hero.letterbox,
  },
  pageHeader: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    alignItems: 'flex-end',
  },
  pagePoster: {
    width: 64,
    height: 96,
    borderRadius: 4,
    backgroundColor: Hero.scrim,
    borderWidth: 1,
    borderColor: Hero.hairline,
  },
  pageHeaderText: { flex: 1, gap: 2, paddingBottom: 2 },
  pageEyebrow: {
    fontFamily: Type.semibold,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: Glow,
  },
  pageTitle: { fontFamily: Type.display, color: Hero.text, fontSize: 22, lineHeight: 30 },
  pageMeta: {
    fontFamily: Type.semibold,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: Hero.textMuted,
    textShadowColor: Hero.shadow,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  pageBody: { padding: Spacing.three, paddingTop: Spacing.two },
  ghostBand: { position: 'absolute', top: 24, height: 38, left: 0, right: 0 },
  ghostFinger: {
    position: 'absolute',
    top: 5,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(13,148,136,0.3)',
    borderWidth: 2,
    borderColor: Accent,
  },
  center: { textAlign: 'center' },
  demoBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  demoPage: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  demoGhostBand: { position: 'absolute', top: 150, height: 38, left: 0, right: 0 },
  demoBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  demoTab: { flex: 1, alignItems: 'center', gap: Spacing.half, paddingVertical: Spacing.two },
  bottom: { paddingHorizontal: Spacing.four, gap: Spacing.three, paddingTop: Spacing.two },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two },
  dot: { height: 8, borderRadius: 4 },
  buttons: { flexDirection: 'row', gap: Spacing.three },
  button: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  secondaryBtn: { flex: 1, borderWidth: 1.5 },
  primaryBtn: { flex: 2, backgroundColor: Accent },
  buttonText: { fontWeight: '700', fontSize: 16 },
});
