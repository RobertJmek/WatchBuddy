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
import { SwipeToLogRow } from '@/components/swipe-to-log-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopSafeAreaView } from '@/components/top-safe-area';
import { UserRow } from '@/components/user-row';
import { Accent, AccentText, Danger, PlaceholderBg, Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import {
  getLibraryStatus,
  removeFromLibrary,
  setLibraryStatus,
  type LibraryStatus,
} from '@/lib/library';
import { searchUsers } from '@/lib/social';
import { subscribeTabReset } from '@/lib/tab-reset';
import {
  fetchAllEpisodes,
  getTitle,
  getTrending,
  imageUrl,
  searchTitles,
  titleQueryOptions,
  type SearchResult,
} from '@/lib/tmdb';
import {
  logManyEpisodeWatches,
  logMovieWatch,
  removeEpisodeWatchesByIds,
  removeMovieWatch,
} from '@/lib/watches';

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

/**
 * One swipe-logged Search row, remembered for the session. Holds exactly the
 * rows the swipe inserted so undo reverses them precisely — and, for movies, the
 * pre-log Library status so undo can restore it (logMovieWatch forces Completed).
 */
type LoggedEntry = {
  kind: 'movie' | 'tv';
  titleId: string;
  watchIds: string[];
  priorStatus: LibraryStatus | null;
};

function ResultRow({
  item,
  bg,
  router,
  logged,
  busy,
  onUndoTap,
}: {
  item: SearchResult;
  bg: string;
  router: ReturnType<typeof useRouter>;
  /** True while this row is marked logged from a swipe this session. */
  logged: boolean;
  /** True while a swipe-log/undo for this row is in flight (series can be slow). */
  busy: boolean;
  /** Tapping the checkmark undoes the session log (same as swipe-left). */
  onUndoTap: () => void;
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
      {busy ? (
        <ActivityIndicator style={styles.trailing} />
      ) : logged ? (
        // Its own Pressable captures the touch, so tapping the check undoes
        // instead of opening the title (RN doesn't bubble to the parent).
        <Pressable style={styles.check} hitSlop={8} onPress={onUndoTap}>
          <IconSymbol name="checkmark" size={18} tintColor={AccentText} />
        </Pressable>
      ) : null}
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

  // --- swipe-to-log (session-scoped) --------------------------------------
  const queryClient = useQueryClient();
  const [logged, setLogged] = useState<Map<string, LoggedEntry>>(new Map());
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());

  const itemKey = (r: SearchResult) => `${r.media_type}-${r.tmdb_id}`;

  function setBusy(key: string, on: boolean) {
    setBusyKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function invalidateWatchData(titleId?: string) {
    queryClient.invalidateQueries({ queryKey: ['diary'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    if (titleId) {
      // A movie log/undo also moves its Library status → refresh those views.
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['libraryStatus', titleId] });
    }
  }

  async function logItem(item: SearchResult) {
    const key = itemKey(item);
    if (logged.has(key) || busyKeys.has(key)) return;
    setBusy(key, true);
    try {
      // Same read-through the row already prefetches onPressIn → usually warm.
      const { title, seasons } = await getTitle(item.tmdb_id, item.media_type);
      if (item.media_type === 'tv') {
        const seasonNumbers = seasons
          .map((s) => s.season_number)
          .filter((n) => n >= 1) // exclude Specials (season 0)
          .sort((a, b) => a - b);
        const episodes = await fetchAllEpisodes(item.tmdb_id, seasonNumbers);
        const ids = await logManyEpisodeWatches(
          episodes.map((e) => ({ id: e.id, title_id: e.title_id })),
        );
        setLogged((prev) =>
          new Map(prev).set(key, {
            kind: 'tv',
            titleId: title.id,
            watchIds: ids,
            priorStatus: null,
          }),
        );
        invalidateWatchData();
      } else {
        const priorStatus = await getLibraryStatus(title.id);
        const watchId = await logMovieWatch(title.id);
        setLogged((prev) =>
          new Map(prev).set(key, {
            kind: 'movie',
            titleId: title.id,
            watchIds: [watchId],
            priorStatus,
          }),
        );
        invalidateWatchData(title.id);
      }
    } catch {
      // Leave the row unmarked on failure; the user can just swipe again.
    } finally {
      setBusy(key, false);
    }
  }

  async function undoItem(item: SearchResult) {
    const key = itemKey(item);
    const entry = logged.get(key);
    if (!entry || busyKeys.has(key)) return;
    setBusy(key, true);
    try {
      if (entry.kind === 'movie') {
        await removeMovieWatch(entry.watchIds[0]);
        // Restore the pre-log status exactly; if there was none, drop the entry
        // the log implicitly created.
        if (entry.priorStatus)
          await setLibraryStatus(entry.titleId, entry.priorStatus);
        else await removeFromLibrary(entry.titleId);
        invalidateWatchData(entry.titleId);
      } else {
        await removeEpisodeWatchesByIds(entry.watchIds);
        invalidateWatchData();
      }
      setLogged((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    } catch {
      // Keep the checkmark on failure so the undo can be retried.
    } finally {
      setBusy(key, false);
    }
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
            renderItem={({ item }) => {
              const key = itemKey(item);
              const isLogged = logged.has(key);
              return (
                <SwipeToLogRow
                  onLog={() => logItem(item)}
                  logLabel={
                    item.media_type === 'tv' ? 'Log whole series' : 'Log watch'
                  }
                  longLog={item.media_type === 'tv'}
                  onUndo={isLogged ? () => undoItem(item) : undefined}>
                  <ResultRow
                    item={item}
                    bg={c.backgroundElement}
                    router={router}
                    logged={isLogged}
                    busy={busyKeys.has(key)}
                    onUndoTap={() => undoItem(item)}
                  />
                </SwipeToLogRow>
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
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailing: { width: 28, alignItems: 'center' },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  error: { color: Danger, marginTop: Spacing.three },
});
