import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { IconSymbol } from '@/components/icon-symbol';
import { RowSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { DiaryRow } from '@/components/diary-row';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import {
  DIARY_PERIODS,
  rangeForPeriod,
  type DiaryPeriod,
} from '@/lib/diary-period';
import { keys } from '@/lib/keys';
import {
  getDiary,
  updateWatchDay,
  type DiaryEntry,
  type DiaryRange,
} from '@/lib/watches';

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDay(d: Date) {
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}


export default function DiaryScreen() {
  const c = useTheme();
  const [period, setPeriod] = useState<DiaryPeriod>('all');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const term = useDebouncedValue(query.trim().toLowerCase(), 250);

  const toggleSearch = useCallback(() => {
    setSearching((s) => {
      if (s) setQuery('');
      return !s;
    });
  }, []);

  // Date-editing state: the entry whose watch day is being changed.
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<DiaryEntry | null>(null);

  const saveWatchDay = useCallback(
    async (entry: DiaryEntry, day: Date) => {
      setEditing(null);
      await updateWatchDay(entry.kind, entry.rows, day);
      queryClient.invalidateQueries({ queryKey: keys.diary() });
      queryClient.invalidateQueries({ queryKey: keys.stats() });
    },
    [queryClient],
  );

  // Custom range state. Defaults to [start of this month, today].
  const today = startOfDay(new Date());
  const [customStart, setCustomStart] = useState<Date>(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [customEnd, setCustomEnd] = useState<Date>(today);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);

  const range: DiaryRange =
    period === 'custom'
      ? {
          from: startOfDay(customStart).toISOString(),
          // `to` is exclusive, so add a day to make the end date inclusive.
          to: new Date(startOfDay(customEnd).getTime() + 86400000).toISOString(),
          limit: null,
        }
      : rangeForPeriod(period);
  const {
    data: entries = [],
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: [...keys.diary(), period, range.from ?? null, range.to ?? null],
    queryFn: () => getDiary(range),
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Diary',
          headerRight: () => (
            <Pressable
              onPress={toggleSearch}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Search the diary">
              <IconSymbol
                name="magnifyingglass"
                size={20}
                tintColor={c.textSecondary}
              />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipBar}>
        {DIARY_PERIODS.map((p) => {
          const active = p.value === period;
          return (
            <Pressable
              key={p.value}
              onPress={() => setPeriod(p.value)}
              style={[
                styles.chip,
                { borderColor: c.border },
                active && styles.chipActive,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}>
              <ThemedText
                type="small"
                style={active ? styles.chipTextActive : undefined}>
                {p.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>

      {searching && (
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.searchInput, { color: c.text, backgroundColor: c.backgroundElement }]}
            placeholder="Search your diary"
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
              style={styles.searchClear}
              hitSlop={8}
              onPress={toggleSearch}
              accessibilityRole="button"
              accessibilityLabel="Close search">
              <IconSymbol name="xmark" size={18} tintColor={c.textSecondary} />
            </Pressable>
          )}
        </View>
      )}

      {period === 'custom' && (
        <View style={styles.customRow}>
          <Pressable
            style={[styles.dateField, { backgroundColor: c.backgroundElement }]}
            onPress={() => setPicking('start')}
            accessibilityRole="button"
            accessibilityLabel={`From ${formatDay(customStart)}`}>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              From
            </ThemedText>
            <ThemedText type="smallBold">{formatDay(customStart)}</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.dateField, { backgroundColor: c.backgroundElement }]}
            onPress={() => setPicking('end')}
            accessibilityRole="button"
            accessibilityLabel={`To ${formatDay(customEnd)}`}>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              To
            </ThemedText>
            <ThemedText type="smallBold">{formatDay(customEnd)}</ThemedText>
          </Pressable>
        </View>
      )}

      {/* Android shows its own dialog; iOS renders inline, so we host it in a
          modal so it isn't pushed off-screen below the list. */}
      {picking &&
        Platform.OS === 'android' &&
        (() => {
          const field = picking;
          return (
            <DateTimePicker
              mode="date"
              value={field === 'start' ? customStart : customEnd}
              maximumDate={field === 'start' ? customEnd : today}
              minimumDate={field === 'end' ? customStart : undefined}
              onValueChange={(_, date) => {
                setPicking(null);
                const day = startOfDay(date);
                if (field === 'start') setCustomStart(day);
                else setCustomEnd(day);
              }}
              onDismiss={() => setPicking(null)}
            />
          );
        })()}

      {Platform.OS === 'ios' && (
        <Modal
          visible={!!picking}
          transparent
          animationType="fade"
          onRequestClose={() => setPicking(null)}>
          <Pressable
            style={styles.backdrop}
            onPress={() => setPicking(null)}
            accessibilityRole="button"
            accessibilityLabel="Close date picker">
            <Pressable
              style={[styles.sheet, { backgroundColor: c.background }]}
              onPress={(e) => e.stopPropagation()}>
              <DateTimePicker
                mode="date"
                display="inline"
                value={picking === 'end' ? customEnd : customStart}
                maximumDate={picking === 'end' ? today : customEnd}
                minimumDate={picking === 'end' ? customStart : undefined}
                onValueChange={(_, date) => {
                  const day = startOfDay(date);
                  if (picking === 'start') setCustomStart(day);
                  else setCustomEnd(day);
                }}
              />
              <Pressable
                style={styles.doneBtn}
                onPress={() => setPicking(null)}
                accessibilityRole="button">
                <ThemedText style={styles.doneText}>Done</ThemedText>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Watch-day editor: Android uses the system dialog, iOS the same modal
          sheet pattern as the custom range picker above. */}
      {editing && Platform.OS === 'android' && (
        <DateTimePicker
          mode="date"
          value={new Date(editing.watched_at)}
          maximumDate={today}
          onValueChange={(_, date) => {
            const entry = editing;
            saveWatchDay(entry, startOfDay(date));
          }}
          onDismiss={() => setEditing(null)}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal
          visible={!!editing}
          transparent
          animationType="fade"
          onRequestClose={() => setEditing(null)}>
          <Pressable
            style={styles.backdrop}
            onPress={() => setEditing(null)}
            accessibilityRole="button"
            accessibilityLabel="Close date picker">
            <Pressable
              style={[styles.sheet, { backgroundColor: c.background }]}
              onPress={(e) => e.stopPropagation()}>
              {editing && (
                <DateTimePicker
                  mode="date"
                  display="inline"
                  value={new Date(editing.watched_at)}
                  maximumDate={today}
                  onValueChange={(_, date) => {
                    const entry = editing;
                    saveWatchDay(entry, startOfDay(date));
                  }}
                />
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {loading ? (
        <View style={styles.list}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : (
        <Animated.FlatList
          data={
            term
              ? entries.filter((e) => e.titleName.toLowerCase().includes(term))
              : entries
          }
          keyExtractor={(e) => e.id}
          itemLayoutAnimation={LinearTransition.duration(200)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={c.tint}
              colors={[c.tint]}
            />
          }
          ListEmptyComponent={
            term ? (
              <EmptyState
                icon="magnifyingglass"
                title={`No entries match “${query.trim()}”`}
                hint="Try a shorter title."
              />
            ) : (
              <EmptyState
                icon="book.closed"
                title={
                  period === 'all'
                    ? 'No watch history yet'
                    : 'Nothing in this period'
                }
                hint={
                  period === 'all'
                    ? 'Tick off episodes or log a movie to start your diary.'
                    : 'Try a wider period.'
                }
              />
            )
          }
          renderItem={({ item, index }) => (
            <Animated.View
              entering={FadeInDown.delay(Math.min(index, 12) * 30).duration(220)}>
              <DiaryRow item={item} onEdit={setEditing} />
            </Animated.View>
          )}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  chipBar: { flexGrow: 0 },
  searchRow: {
    justifyContent: 'center',
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  searchInput: {
    borderRadius: Spacing.three,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.five + Spacing.two,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  searchClear: { position: 'absolute', right: Spacing.three },
  chips: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: Accent, borderColor: Accent },
  chipTextActive: { color: AccentText },
  customRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  dateField: {
    flex: 1,
    gap: Spacing.half,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
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
  },
  doneBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    backgroundColor: Accent,
  },
  doneText: { color: AccentText, fontWeight: '700' },
  list: { padding: Spacing.three, gap: Spacing.two },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
