import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { PosterShelf, type PosterItem } from '@/components/poster-shelf';
import { EmptyState } from '@/components/empty-state';
import { IconSymbol } from '@/components/icon-symbol';
import { SearchRow } from '@/components/search-row';
import { ShelfSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopSafeAreaView } from '@/components/top-safe-area';
import { UserRow } from '@/components/user-row';
import { Danger, Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { hapticTick } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import { openTitle } from '@/lib/navigation';
import { searchUsers } from '@/lib/social';
import { subscribeTabReset } from '@/lib/tab-reset';
import { getTrending, searchTitles, type SearchResult } from '@/lib/tmdb';
import { itemKey, useSearchLog } from '@/lib/use-search-log';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 500;

function toPosterItem(r: SearchResult): PosterItem {
  return {
    key: `${r.media_type}-${r.tmdb_id}`,
    tmdb_id: r.tmdb_id,
    media_type: r.media_type,
    title: r.title,
    poster_path: r.poster_path,
  };
}

export default function SearchScreen() {
  const router = useRouter();
  const c = useTheme();
  const focused = useIsFocused();

  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  // The term the user explicitly submitted (button or the keyboard's Search
  // key). It outranks the debounced live term, which is what lets 1-2 character
  // titles ("It", "Up", "M") be searched at all. Editing the box clears it in
  // the same batch as `setQuery` (see `onChangeText`), so it is non-empty only
  // while it equals `trimmed` — by construction, not by a comparison that has
  // to be repeated at every use. No effect syncs the two.
  const [submitted, setSubmitted] = useState('');

  const inputRef = useRef<TextInput>(null);
  const trendingRef = useRef<ScrollView>(null);

  // Re-tapping the active Search tab clears the query (back to trending), drops
  // the keyboard, and scrolls to the top. Guarded by focus so a plain tab switch
  // doesn't reset anything.
  useEffect(() => {
    return subscribeTabReset('explore', () => {
      if (!focused) return;
      setQuery('');
      setSubmitted('');
      inputRef.current?.blur();
      Keyboard.dismiss();
      trendingRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [focused]);

  // A leading '@' switches to people-search; the '@' is the trigger only and
  // the rest is the username/name query.
  const isPeople = trimmed.startsWith('@');
  const peopleTerm = isPeople ? trimmed.slice(1).trim() : '';
  const peopleDebounced = useDebouncedValue(peopleTerm, DEBOUNCE_MS);

  // Live type-ahead, unchanged: 3+ characters, settled for DEBOUNCE_MS.
  const debounced = useDebouncedValue(trimmed, DEBOUNCE_MS);
  const liveTerm = debounced.length >= MIN_CHARS ? debounced : '';
  // One precedence rule, because `submitted` can only be non-empty while it
  // equals `trimmed`. Nothing else has to re-derive that agreement.
  const term = submitted || liveTerm;
  const searching = !isPeople && term.length > 0;

  // people: '@' alone -> hint, else live people results.
  // titles: empty -> trending feed; 1-2 chars -> hint until submitted; else
  // results. Keyed on the *typed* length, not on `term`: the debounce window
  // must not bounce a long query back to the hint.
  const mode: 'trending' | 'hint' | 'search' | 'people-hint' | 'people' =
    isPeople
      ? peopleTerm.length === 0
        ? 'people-hint'
        : 'people'
      : trimmed.length === 0
        ? 'trending'
        : trimmed.length < MIN_CHARS && !submitted
          ? 'hint'
          : 'search';

  const search = useQuery({
    queryKey: keys.search(term),
    queryFn: () => searchTitles(term),
    enabled: searching,
    placeholderData: keepPreviousData,
  });

  // The box holds a query the rows on screen don't answer yet — the debounce
  // window, mostly. Distinct from `isFetching` because during it the query is
  // *disabled*: without it the list would flash "No results", and the previous
  // term's rows would sit there undimmed, reading as current.
  const settling = mode === 'search' && term !== trimmed;
  const searchBusy = search.isFetching || settling;
  // The submit button is dimmed while it is fetching the term already in the
  // box; it stays pressable, because in that state it is the retry.
  const submitBusy = search.isFetching && term === trimmed;

  const submit = () => {
    if (!trimmed || isPeople) return;
    hapticTick();
    Keyboard.dismiss();
    // Submitting a term that is already the live one wouldn't change the query
    // key, so nothing would be sent — which would make the button inert exactly
    // where it is most wanted, as a retry after a failed request.
    if (term === trimmed) void search.refetch();
    else setSubmitted(trimmed);
  };

  const people = useQuery({
    queryKey: keys.userSearch(peopleDebounced),
    queryFn: () => searchUsers(peopleDebounced),
    enabled: isPeople && peopleDebounced.length > 0,
    placeholderData: keepPreviousData,
  });

  const trending = useQuery({
    queryKey: keys.trending(),
    queryFn: getTrending,
    staleTime: 1000 * 60 * 60 * 24, // 24h — the weekly feed barely moves.
  });

  // PosterShelf is memoized, so every prop it takes has to be referentially
  // stable or the memo buys nothing — the shelves re-render (and re-render
  // every poster) on each keystroke in the search box otherwise.
  const openPoster = useCallback(
    (item: PosterItem) => {
      openTitle(router, {
        tmdbId: item.tmdb_id,
        mediaType: item.media_type,
        name: item.title,
      });
    },
    [router],
  );

  const trendingMovies = useMemo(
    () => (trending.data?.movies ?? []).map(toPosterItem),
    [trending.data],
  );
  const trendingTv = useMemo(
    () => (trending.data?.tv ?? []).map(toPosterItem),
    [trending.data],
  );

  const openTrendingMovies = useCallback(
    () =>
      router.push({
        pathname: '/trending-section',
        params: { type: 'movie', label: 'Hot Movies' },
      }),
    [router],
  );
  const openTrendingTv = useCallback(
    () =>
      router.push({
        pathname: '/trending-section',
        params: { type: 'tv', label: 'Hot TV' },
      }),
    [router],
  );

  const { logged, logItem, undoItem } = useSearchLog();

  return (
    <ThemedView style={styles.container}>
      <TopSafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.heading}>
          Search
        </ThemedText>
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={[
              styles.input,
              { color: c.text, backgroundColor: c.backgroundElement },
              // Reserve the icon gutter only once there is something to show in
              // it, so the placeholder gets the full width of an empty box and
              // the text doesn't reflow as the spinner comes and goes.
              query.length > 0 ? styles.inputWithIcons : null,
            ]}
            placeholder="Movies, TV, or @username"
            placeholderTextColor={c.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              // Retire the submitted term on any edit, in the same batch. That
              // is what keeps `submitted` equal to `trimmed` whenever it is
              // set — without it, deleting back through a submitted value
              // would silently re-arm it.
              setSubmitted('');
            }}
            onSubmitEditing={submit}
          />
          <View style={styles.inputIcons} pointerEvents="box-none">
            {((mode === 'search' && searchBusy) ||
              (mode === 'people' && people.isFetching)) && <ActivityIndicator />}
            {!isPeople && trimmed.length > 0 && (
              <Pressable
                style={submitBusy ? styles.dimmed : undefined}
                hitSlop={8}
                onPress={submit}
                accessibilityRole="button"
                accessibilityLabel="Search"
                accessibilityState={{ busy: submitBusy }}>
                <IconSymbol name="magnifyingglass" size={18} tintColor={c.textSecondary} />
              </Pressable>
            )}
            {query.length > 0 && (
              <Pressable
                hitSlop={8}
                onPress={() => {
                  setQuery('');
                  setSubmitted('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Clear search">
                <IconSymbol name="xmark" size={18} tintColor={c.textSecondary} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Errors only replace content when there's nothing cached to show. */}
        {mode === 'search' && search.error && !search.data && (
          <ThemedText style={styles.error}>{String(search.error)}</ThemedText>
        )}
        {mode === 'people' && people.error && !people.data && (
          <ThemedText style={styles.error}>{String(people.error)}</ThemedText>
        )}

        {mode === 'hint' && (
          <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
            Keep typing, or tap search for short titles.
          </ThemedText>
        )}

        {mode === 'people-hint' && (
          <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
            Type a username to find people.
          </ThemedText>
        )}

        {mode === 'people' && (
          <FlatList
            data={people.data ?? []}
            keyExtractor={(u) => u.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            style={people.isFetching ? styles.dimmed : undefined}
            ListEmptyComponent={
              !people.isFetching ? (
                <EmptyState
                  icon="person.2"
                  title="No people found"
                  hint="Usernames match from the first letters."
                />
              ) : null
            }
            renderItem={({ item }) => <UserRow user={item} />}
          />
        )}

        {mode === 'search' && (
          <FlatList
            data={search.data ?? []}
            keyExtractor={(r) => `${r.media_type}-${r.tmdb_id}`}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            style={searchBusy ? styles.dimmed : undefined}
            ListEmptyComponent={
              !searchBusy ? (
                <EmptyState
                  icon="magnifyingglass"
                  title="No results"
                  hint="Check the spelling or try the original title."
                />
              ) : null
            }
            renderItem={({ item }) => {
              const key = itemKey(item);
              return (
                <SearchRow
                  item={item}
                  bg={c.backgroundElement}
                  router={router}
                  logged={logged.has(key)}
                  pending={logged.get(key)?.pending ?? false}
                  onLog={logItem}
                  onUndo={undoItem}
                />
              );
            }}
          />
        )}

        {mode === 'trending' &&
          (trending.isLoading ? (
            <View style={{ gap: Spacing.four, paddingVertical: Spacing.two }}>
              <ShelfSkeleton />
              <ShelfSkeleton />
            </View>
          ) : trending.error && !trending.data ? (
            <EmptyState
              icon="film"
              title="Couldn't load Hot"
              hint="The movie database seems unreachable. Try again in a bit."
            />
          ) : (
            <ScrollView
              ref={trendingRef}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled">
              {trending.error != null && (
                <ThemedText
                  type="small"
                  style={[styles.atHint, { color: c.textSecondary }]}>
                  Couldn’t refresh — showing saved data.
                </ThemedText>
              )}
              <ThemedText
                type="small"
                style={[styles.atHint, { color: c.textSecondary }]}>
                Tip: start with @ to find and follow other people based on their
                username.
              </ThemedText>
              <PosterShelf
                title="Hot Movies"
                items={trendingMovies}
                onPressItem={openPoster}
                showCount={false}
                onPressHeader={openTrendingMovies}
              />
              <PosterShelf
                title="Hot TV"
                items={trendingTv}
                onPressItem={openPoster}
                showCount={false}
                onPressHeader={openTrendingTv}
              />
            </ScrollView>
          ))}
      </TopSafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  atHint: { paddingHorizontal: Spacing.two },
  heading: { marginTop: Spacing.three, marginBottom: Spacing.two },
  inputRow: { justifyContent: 'center' },
  input: {
    borderRadius: Spacing.three,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  // Room for the spinner, the search button and the clear button side by side:
  // the row's own right inset, three ~20px glyphs and the two gaps between them.
  inputWithIcons: { paddingRight: Spacing.six + Spacing.five + Spacing.two },
  inputIcons: {
    position: 'absolute',
    right: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  dimmed: { opacity: 0.4 },
  list: { gap: Spacing.two, paddingVertical: Spacing.three },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  error: { color: Danger, marginTop: Spacing.three },
});
