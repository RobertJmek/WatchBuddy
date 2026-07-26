import { useQuery } from '@tanstack/react-query';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { FilterChips } from '@/components/filter-chips';
import { IconSymbol } from '@/components/icon-symbol';
import { LibraryFilterSheet } from '@/components/library-filter-sheet';
import { PosterShelf, type PosterItem } from '@/components/poster-shelf';
import { ShelfSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopSafeAreaView } from '@/components/top-safe-area';
import { Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { getGenres } from '@/lib/genres';
import { getLibrary, LIBRARY_STATUSES, type MyLibraryEntry } from '@/lib/library';
import {
  applyFilter,
  EMPTY_FILTER,
  filterToParams,
  isActive,
  yearBounds,
} from '@/lib/library-filter';
import { subscribeTabReset } from '@/lib/tab-reset';

function toPosterItem(e: MyLibraryEntry): PosterItem | null {
  if (!e.title) return null;
  return {
    key: e.id,
    tmdb_id: e.title.tmdb_id,
    media_type: e.title.media_type,
    title: e.title.title,
    poster_path: e.title.poster_path,
  };
}

function shelfItems(
  entries: MyLibraryEntry[],
  predicate: (e: MyLibraryEntry) => boolean,
) {
  return entries
    .filter(predicate)
    .map(toPosterItem)
    .filter((i): i is PosterItem => i !== null);
}

export default function LibraryScreen() {
  const router = useRouter();
  const c = useTheme();
  // Deliberately no refetch-on-focus: every write that can change this list
  // already invalidates ['library'] (explore, movie-watch-bar, favorite-button,
  // library-status-bar, rating-bar, and a blanket invalidate in both importers),
  // so a blind refetch per tab focus just re-downloaded the whole library —
  // twice a visit, since backing out of a category focuses this screen again.
  // Pull-to-refresh covers "changed on another device".
  const {
    data: entries = [],
    isLoading: loading,
    error,
    refetch,
  } = useQuery({ queryKey: ['library'], queryFn: getLibrary });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const { data: genres = [] } = useQuery({
    queryKey: ['genres'],
    queryFn: getGenres,
    staleTime: Infinity,
  });

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const term = useDebouncedValue(query.trim().toLowerCase(), 250);

  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  const filtered = isActive(filter);

  function toggleSearch() {
    if (searching) setQuery('');
    setSearching(!searching);
  }

  const focused = useIsFocused();
  const listRef = useRef<ScrollView>(null);

  // Re-tapping the active Library tab is the screen's reset gesture: it closes
  // the (optional) inline search, drops any filter, and scrolls the shelves
  // back to the top. Guarded by focus so a plain tab switch leaves state alone.
  useEffect(() => {
    return subscribeTabReset('library', () => {
      if (!focused) return;
      if (searching) {
        setSearching(false);
        setQuery('');
      }
      setFilter(EMPTY_FILTER);
      listRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [focused, searching]);

  // Search narrows every shelf at once, then the filter narrows what's left —
  // the two combine with AND. Shelves with no matches self-hide below.
  const searched = term
    ? entries.filter((e) => e.title?.title.toLowerCase().includes(term))
    : entries;
  const visible = applyFilter(searched, filter);

  // One shelf per status (canonical order), then one for favorites. Favorites
  // used to be split into Movies/TV shelves; media type is a filter axis now,
  // which also matches the single Favorites shelf on the public profile.
  const statusShelves = LIBRARY_STATUSES.map(({ value, label }) => ({
    key: `status-${value}`,
    label,
    params: { status: value, label },
    items: shelfItems(visible, (e) => e.status === value),
  }));

  const favoriteShelf = {
    key: 'favorites',
    label: 'Favorites',
    params: { favorite: 'true', label: 'Favorites' },
    items: shelfItems(visible, (e) => e.is_favorite),
  };

  const shelves = [...statusShelves, favoriteShelf].filter(
    (s) => s.items.length > 0,
  );

  const narrowed = filtered || !!term;
  const genreNames = new Map(genres.map((g) => [g.id, g.name]));
  // Only offer genres the library actually contains — a chip that can only ever
  // return nothing is worse than no chip.
  const availableGenreIds = new Set(entries.flatMap((e) => e.genreIds));

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
        <ThemedText type="meta" style={[styles.eyebrow, { color: c.textSecondary }]}>
          {(() => {
            const total = entries.filter((e) => e.title).length;
            const shown = visible.filter((e) => e.title).length;
            const noun = total === 1 ? 'Title' : 'Titles';
            // Say so when you're looking at a slice — a vanished shelf is
            // otherwise indistinguishable from an emptied one.
            return narrowed && shown !== total
              ? `${shown} of ${total} ${noun}`
              : `${total} ${noun}`;
          })()}
        </ThemedText>
        <View style={styles.headingRow}>
          <ThemedText type="title" style={styles.heading}>
            Library
          </ThemedText>
          <View style={styles.headerActions}>
            <Pressable onPress={toggleSearch} hitSlop={8} style={styles.searchBtn}>
              <IconSymbol
                name="magnifyingglass"
                size={22}
                tintColor={c.textSecondary}
              />
            </Pressable>
            <Pressable
              onPress={() => setFilterOpen(true)}
              hitSlop={8}
              style={styles.searchBtn}>
              <IconSymbol
                name="line.3.horizontal.decrease"
                size={22}
                tintColor={filtered ? c.tint : c.textSecondary}
              />
            </Pressable>
          </View>
        </View>

        {searching && (
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { color: c.text, backgroundColor: c.backgroundElement }]}
              placeholder="Search your library"
              placeholderTextColor={c.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="search"
              value={query}
              onChangeText={setQuery}
            />
            {(
              <Pressable
                style={styles.inputClear}
                hitSlop={8}
                onPress={toggleSearch}>
                <IconSymbol name="xmark" size={18} tintColor={c.textSecondary} />
              </Pressable>
            )}
          </View>
        )}

        <FilterChips
          filter={filter}
          genreNames={genreNames}
          onChange={setFilter}
        />

        <LibraryFilterSheet
          visible={filterOpen}
          onClose={() => setFilterOpen(false)}
          filter={filter}
          onApply={setFilter}
          genres={genres}
          availableGenreIds={availableGenreIds}
          yearDomain={yearBounds(entries)}
        />

        {loading ? (
          <ScrollView contentContainerStyle={styles.list} scrollEnabled={false}>
            <ShelfSkeleton />
            <ShelfSkeleton />
            <ShelfSkeleton />
          </ScrollView>
        ) : (
          <ScrollView
            ref={listRef}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={c.tint}
                colors={[c.tint]}
              />
            }>
            {/* A failed refresh keeps showing the cached shelves. */}
            {error && entries.length === 0 ? (
              <EmptyState
                icon="film"
                title="Couldn't load your library"
                hint="Pull to refresh, or sign out and back in."
              />
            ) : shelves.length === 0 ? (
              term ? (
                <EmptyState
                  icon="magnifyingglass"
                  title={`No titles match “${query.trim()}”`}
                  hint="Try a shorter title."
                />
              ) : filtered ? (
                <EmptyState
                  icon="line.3.horizontal.decrease"
                  title="No titles match your filter"
                  hint="Genres stack: a title has to carry every one you pick."
                />
              ) : (
                <EmptyState
                  icon="film"
                  title="Nothing here yet"
                  hint="Find something in Search and set a status."
                />
              )
            ) : (
              shelves.map((s) => (
                <PosterShelf
                  key={s.key}
                  title={s.label}
                  items={s.items}
                  onPressItem={openTitle}
                  onPressHeader={() =>
                    router.push({
                      pathname: '/library-section',
                      // The filter travels into the category and is editable
                      // there, but changes never come back — see library-filter.
                      params: { ...s.params, ...filterToParams(filter) },
                    })
                  }
                />
              ))
            )}
          </ScrollView>
        )}
      </TopSafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  eyebrow: { marginTop: Spacing.three },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { marginTop: Spacing.half, marginBottom: Spacing.two },
  searchBtn: { padding: Spacing.half },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  inputRow: { justifyContent: 'center', marginBottom: Spacing.two },
  input: {
    borderRadius: Spacing.three,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.five + Spacing.two,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  inputClear: { position: 'absolute', right: Spacing.three },
  list: { gap: Spacing.four, paddingVertical: Spacing.two },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
