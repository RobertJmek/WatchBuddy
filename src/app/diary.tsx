import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  DIARY_PERIODS,
  rangeForPeriod,
  type DiaryPeriod,
} from '@/lib/diary-period';
import { imageUrl } from '@/lib/tmdb';
import { getDiary, type DiaryRange } from '@/lib/watches';

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
      <Stack.Screen options={{ headerShown: true, title: 'Diary' }} />
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

      {loading ? (
        <ActivityIndicator style={{ marginTop: Spacing.five }} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <ThemedText style={styles.empty}>
              {period === 'all'
                ? 'No watch history yet. Tick off episodes or log a movie.'
                : 'No watch history in this period.'}
            </ThemedText>
          }
          renderItem={({ item }) => (
            <Pressable
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
            </Pressable>
          )}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  chipBar: { flexGrow: 0 },
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
