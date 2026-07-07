import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import { IconSymbol } from '@/components/icon-symbol';
import { PressScale } from '@/components/press-scale';
import { RowSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import {
  DIARY_PERIODS,
  rangeForPeriod,
  type DiaryPeriod,
} from '@/lib/diary-period';
import { imageUrl } from '@/lib/tmdb';
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function DiaryScreen() {
  const router = useRouter();
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
      queryClient.invalidateQueries({ queryKey: ['diary'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
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
    queryKey: ['diary', period, range.from ?? null, range.to ?? null],
    queryFn: () => getDiary(range),
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Diary',
          headerRight: () => (
            <Pressable onPress={toggleSearch} hitSlop={8}>
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
              ]}>
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
          {query.length > 0 && (
            <Pressable
              style={styles.searchClear}
              hitSlop={8}
              onPress={() => setQuery('')}>
              <IconSymbol name="xmark" size={18} tintColor={c.textSecondary} />
            </Pressable>
          )}
        </View>
      )}

      {period === 'custom' && (
        <View style={styles.customRow}>
          <Pressable
            style={[styles.dateField, { backgroundColor: c.backgroundElement }]}
            onPress={() => setPicking('start')}>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              From
            </ThemedText>
            <ThemedText type="smallBold">{formatDay(customStart)}</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.dateField, { backgroundColor: c.backgroundElement }]}
            onPress={() => setPicking('end')}>
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
          <Pressable style={styles.backdrop} onPress={() => setPicking(null)}>
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
              <Pressable style={styles.doneBtn} onPress={() => setPicking(null)}>
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
          <Pressable style={styles.backdrop} onPress={() => setEditing(null)}>
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
          ListEmptyComponent={
            <ThemedText style={styles.empty}>
              {term
                ? `No entries match “${query.trim()}”.`
                : period === 'all'
                  ? 'No watch history yet. Tick off episodes or log a movie.'
                  : 'No watch history in this period.'}
            </ThemedText>
          }
          renderItem={({ item, index }) => (
            <Animated.View
              entering={FadeInDown.delay(Math.min(index, 12) * 30).duration(220)}>
            <PressScale
              style={[styles.row, { backgroundColor: c.backgroundElement }]}
              onPress={() =>
                router.push({
                  pathname: '/title/[id]',
                  params: {
                    id: String(item.tmdbId),
                    type: item.mediaType,
                    name: item.titleName,
                  },
                })
              }>
              <Image
                style={styles.poster}
                source={{ uri: imageUrl(item.posterPath, 'w185') ?? undefined }}
                contentFit="cover"
                transition={150}
              />
              <ThemedView style={styles.rowText}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {item.titleName}
                </ThemedText>
                {item.subtitle && (
                  <ThemedText type="small" numberOfLines={1}>
                    {item.subtitle}
                  </ThemedText>
                )}
                <ThemedText type="small" style={styles.date}>
                  {formatDate(item.watched_at)}
                </ThemedText>
              </ThemedView>
              <Pressable
                hitSlop={8}
                style={styles.editBtn}
                onPress={() => setEditing(item)}>
                <IconSymbol name="calendar" size={18} tintColor={c.textSecondary} />
              </Pressable>
            </PressScale>
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
  editBtn: { alignSelf: 'center', paddingHorizontal: Spacing.two },
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
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
    padding: Spacing.two,
    borderRadius: Spacing.three,
  },
  poster: {
    width: 44,
    height: 66,
    borderRadius: Spacing.one,
    backgroundColor: '#0002',
  },
  rowText: { flex: 1, gap: Spacing.half, backgroundColor: 'transparent' },
  date: { opacity: 0.6 },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
