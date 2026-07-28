import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Button } from '@/components/button';
import { IconSymbol } from '@/components/icon-symbol';
import { RangeSlider } from '@/components/range-slider';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Genre } from '@/lib/genres';
import { hapticSuccess, hapticTick, hapticToggle } from '@/lib/haptics';
import {
  EMPTY_FILTER,
  RATING_DOMAIN,
  type LibraryFilter,
  type Range,
} from '@/lib/library-filter';

const TYPES: { value: LibraryFilter['mediaType']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'TV' },
];

/**
 * How many genre chips the sheet shows before the fold — about two rows.
 * A library spans ~25 genres, and wrapping all of them pushed both sliders out
 * of a sheet capped at 70% of the screen: you had to scroll to reach an axis you
 * couldn't see existed. `genreOptions` puts the most-used first, so the short
 * list is the useful one.
 */
const COLLAPSED_GENRES = 8;

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { borderColor: c.border }, active && styles.chipActive]}>
      <ThemedText type="small" style={active ? styles.chipTextActive : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/**
 * The filter sheet, shared verbatim by Library and by every category — same
 * component, same state shape, so the two screens can't drift apart.
 *
 * Edits are held in a draft and only handed up on Apply, which means backing
 * out (backdrop tap) is a real cancel. The caller passes the genres it wants
 * offered, already ordered (see `genreOptions`) — the sheet doesn't decide which
 * genres exist, only how many of them to show at once.
 */
export function LibraryFilterSheet({
  visible,
  onClose,
  filter,
  onApply,
  genres,
  yearDomain,
}: {
  visible: boolean;
  onClose: () => void;
  filter: LibraryFilter;
  onApply: (next: LibraryFilter) => void;
  /** Genres to offer as chips, in display order — most-used first. */
  genres: Genre[];
  yearDomain: Range;
}) {
  const c = useTheme();
  const [draft, setDraft] = useState(filter);
  const [expanded, setExpanded] = useState(false);

  // Read through a ref so the effect below can see the current genres without
  // depending on their identity.
  const genresRef = useRef(genres);
  genresRef.current = genres;

  // Every opening starts from what's actually applied — including the fold,
  // which opens flat unless a genre you've already picked sits below it. A
  // selected chip you can't see is a filter you can't undo from here.
  useEffect(() => {
    if (!visible) return;
    setDraft(filter);
    setExpanded(
      genresRef.current
        .slice(COLLAPSED_GENRES)
        .some((g) => filter.genreIds.includes(g.id)),
    );
    // `genres` is deliberately not a dependency: it's a fresh array on every
    // parent render, and re-running this would collapse the list under a finger.
  }, [visible, filter]);

  const shown = expanded ? genres : genres.slice(0, COLLAPSED_GENRES);

  function toggleGenre(id: number) {
    const on = draft.genreIds.includes(id);
    hapticToggle(!on);
    setDraft({
      ...draft,
      genreIds: on
        ? draft.genreIds.filter((g) => g !== id)
        : [...draft.genreIds, id],
    });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      {/* A Modal renders in its own window, outside the GestureHandlerRootView
          in _layout.tsx — without one in here the range sliders' pan gestures
          never fire on Android. */}
      <GestureHandlerRootView style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[styles.sheet, { backgroundColor: c.background }]}
            onPress={(e) => e.stopPropagation()}>
            <View style={styles.titleRow}>
              <ThemedText type="subtitle">Filters</ThemedText>
              {/* Dismisses without applying — the same cancel as a backdrop tap,
                  just reachable without aiming outside the sheet. */}
              <Pressable onPress={onClose} hitSlop={10}>
                <IconSymbol name="xmark" size={20} tintColor={c.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}>
              <View style={styles.group}>
                <ThemedText type="smallBold">Type</ThemedText>
                <View style={styles.chipRow}>
                  {TYPES.map((t) => (
                    <Chip
                      key={t.value}
                      label={t.label}
                      active={draft.mediaType === t.value}
                      onPress={() => {
                        hapticTick();
                        setDraft({ ...draft, mediaType: t.value });
                      }}
                    />
                  ))}
                </View>
              </View>

              {genres.length > 0 && (
                <View style={styles.group}>
                  <ThemedText type="smallBold">Genre</ThemedText>
                  <View style={styles.chipRow}>
                    {shown.map((g) => (
                      <Chip
                        key={g.id}
                        label={g.name}
                        active={draft.genreIds.includes(g.id)}
                        onPress={() => toggleGenre(g.id)}
                      />
                    ))}
                  </View>
                  {/* Silent on purpose: this reveals, it doesn't change the
                      filter, and haptics here are reserved for edits. */}
                  {genres.length > COLLAPSED_GENRES && (
                    <Pressable
                      onPress={() => setExpanded(!expanded)}
                      hitSlop={8}
                      style={styles.disclosure}>
                      <ThemedText type="smallBold" style={{ color: c.tint }}>
                        {expanded ? 'Show less' : `Show all (${genres.length})`}
                      </ThemedText>
                    </Pressable>
                  )}
                </View>
              )}

              <RangeSlider
                label="Year"
                formatEmpty="All years"
                domain={yearDomain}
                value={draft.years}
                onChange={(years) => setDraft({ ...draft, years })}
              />

              <RangeSlider
                label="My rating"
                formatEmpty="Any"
                hint={draft.rating ? 'Unrated titles are hidden.' : undefined}
                domain={RATING_DOMAIN}
                value={draft.rating}
                onChange={(rating) => setDraft({ ...draft, rating })}
              />
            </ScrollView>

            <View style={styles.footer}>
              <Pressable
                hitSlop={8}
                onPress={() => {
                  hapticToggle(false);
                  setDraft(EMPTY_FILTER);
                }}>
                <ThemedText type="small" style={{ color: c.textSecondary }}>
                  Clear
                </ThemedText>
              </Pressable>
              <Button
                title="Apply"
                style={styles.apply}
                onPress={() => {
                  hapticSuccess();
                  onApply(draft);
                  onClose();
                }}
              />
            </View>
          </Pressable>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  sheet: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
    maxHeight: '70%',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: Spacing.three, paddingVertical: Spacing.two },
  group: { gap: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  disclosure: { alignSelf: 'flex-start', paddingVertical: Spacing.half },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: Accent, borderColor: Accent },
  chipTextActive: { color: AccentText },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  apply: { flexShrink: 1, minWidth: 120 },
});
