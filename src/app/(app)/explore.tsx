import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { PressScale } from '@/components/press-scale';
import { ShelfSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopSafeAreaView } from '@/components/top-safe-area';
import { UserRow } from '@/components/user-row';
import { Danger, PlaceholderBg, Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { searchUsers } from '@/lib/social';
import { subscribeTabReset } from '@/lib/tab-reset';
import {
  getTrending,
  imageUrl,
  searchTitles,
  titleQueryOptions,
  type SearchResult,
} from '@/lib/tmdb';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 500;

function year(r: SearchResult) {
  return r.release_date ? r.release_date.slice(0, 4) : '—';
}

function toPosterItem(r: SearchResult): PosterItem {
  return {
    key: `${r.media_type}-${r.tmdb_id}`,
    tmdb_id: r.tmdb_id,
    media_type: r.media_type,
    title: r.title,
    poster_path: r.poster_path,
  };
}

function ResultRow({
  item,
  bg,
  router,
}: {
  item: SearchResult;
  bg: string;
  router: ReturnType<typeof useRouter>;
}) {
  const queryClient = useQueryClient();
  return (
    <PressScale
      style={[styles.row, { backgroundColor: bg }]}
      // Warm the detail cache while the finger is still down.
      onPressIn={() =>
        queryClient.prefetchQuery(titleQueryOptions(item.tmdb_id, item.media_type))
      }
      onPress={() =>
        router.push({
          pathname: '/title/[id]',
          params: {
            id: String(item.tmdb_id),
            type: item.media_type,
            name: item.title,
          },
        })
      }>
      <Image
        style={styles.poster}
        source={{ uri: imageUrl(item.poster_path, 'w185') ?? undefined }}
        contentFit="cover"
        transition={150}
      />
      <ThemedView style={styles.rowText}>
        <ThemedText type="smallBold" numberOfLines={2}>
          {item.title}
        </ThemedText>
        <ThemedText type="small">
          {item.media_type === 'tv' ? 'TV' : 'Movie'} · {year(item)}
        </ThemedText>
      </ThemedView>
    </PressScale>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const c = useTheme();
  const focused = useIsFocused();

  const [query, setQuery] = useState('');
  const trimmed = query.trim();

  const inputRef = useRef<TextInput>(null);
  const trendingRef = useRef<ScrollView>(null);

  // Re-tapping the active Search tab clears the query (back to trending), drops
  // the keyboard, and scrolls to the top. Guarded by focus so a plain tab switch
  // doesn't reset anything.
  useEffect(() => {
    return subscribeTabReset('explore', () => {
      if (!focused) return;
      setQuery('');
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

  const term = useDebouncedValue(trimmed, DEBOUNCE_MS);
  const searching = !isPeople && term.length >= MIN_CHARS;

  // people: '@' alone -> hint, else live people results.
  // titles: empty -> trending feed; 1-2 chars -> hint; 3+ -> live results.
  const mode: 'trending' | 'hint' | 'search' | 'people-hint' | 'people' =
    isPeople
      ? peopleTerm.length === 0
        ? 'people-hint'
        : 'people'
      : trimmed.length === 0
        ? 'trending'
        : trimmed.length < MIN_CHARS
          ? 'hint'
          : 'search';

  const search = useQuery({
    queryKey: ['search', term],
    queryFn: () => searchTitles(term),
    enabled: searching,
    placeholderData: keepPreviousData,
  });

  const people = useQuery({
    queryKey: ['userSearch', peopleDebounced],
    queryFn: () => searchUsers(peopleDebounced),
    enabled: isPeople && peopleDebounced.length > 0,
    placeholderData: keepPreviousData,
  });

  const trending = useQuery({
    queryKey: ['trending'],
    queryFn: getTrending,
    staleTime: 1000 * 60 * 60 * 24, // 24h — the weekly feed barely moves.
  });

  function openTitle(item: PosterItem) {
    router.push({
      pathname: '/title/[id]',
      params: {
        id: String(item.tmdb_id),
        type: item.media_type,
        name: item.title,
      },
    });
  }

  return (
    <ThemedView style={styles.container}>
      <TopSafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.heading}>
          Search
        </ThemedText>
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: c.text, backgroundColor: c.backgroundElement }]}
            placeholder="Movies, TV, or @username"
            placeholderTextColor={c.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            value={query}
            onChangeText={setQuery}
          />
          {((mode === 'search' && search.isFetching) ||
            (mode === 'people' && people.isFetching)) && (
            <ActivityIndicator style={styles.inputSpinner} />
          )}
          {query.length > 0 && (
            <Pressable
              style={styles.inputClear}
              hitSlop={8}
              onPress={() => setQuery('')}>
              <IconSymbol name="xmark" size={18} tintColor={c.textSecondary} />
            </Pressable>
          )}
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
            Type at least {MIN_CHARS} characters to search.
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
            style={search.isFetching ? styles.dimmed : undefined}
            ListEmptyComponent={
              !search.isFetching ? (
                <EmptyState
                  icon="magnifyingglass"
                  title="No results"
                  hint="Check the spelling or try the original title."
                />
              ) : null
            }
            renderItem={({ item }) => (
              <ResultRow item={item} bg={c.backgroundElement} router={router} />
            )}
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
              title="Couldn't load trending"
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
                title="Trending Movies"
                items={(trending.data?.movies ?? []).map(toPosterItem)}
                onPressItem={openTitle}
              />
              <PosterShelf
                title="Trending TV"
                items={(trending.data?.tv ?? []).map(toPosterItem)}
                onPressItem={openTitle}
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
    paddingRight: Spacing.five + Spacing.four,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  inputSpinner: { position: 'absolute', right: Spacing.five + Spacing.three },
  inputClear: { position: 'absolute', right: Spacing.three },
  dimmed: { opacity: 0.4 },
  list: { gap: Spacing.two, paddingVertical: Spacing.three },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
    padding: Spacing.two,
    borderRadius: Spacing.three,
  },
  poster: {
    width: 52,
    height: 78,
    borderRadius: 4,
    backgroundColor: PlaceholderBg,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.35)',
  },
  rowText: { flex: 1, gap: Spacing.half, backgroundColor: 'transparent' },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  error: { color: Danger, marginTop: Spacing.three },
});
