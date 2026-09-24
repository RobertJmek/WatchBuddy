import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { IconSymbol } from '@/components/icon-symbol';
import { PressScale } from '@/components/press-scale';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openTitle } from '@/lib/navigation';
import { imageUrl } from '@/lib/tmdb';
import type { DiaryEntry } from '@/lib/watches';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * One watch in a diary list: poster, title, subtitle, date; opens the title.
 * `onEdit` adds the calendar button (only your own diary can be re-dated).
 */
export function DiaryRow({
  item,
  onEdit,
  large = false,
}: {
  item: DiaryEntry;
  onEdit?: (item: DiaryEntry) => void;
  large?: boolean;
}) {
  const c = useTheme();
  const router = useRouter();
  return (
    <PressScale
      style={[styles.row, { backgroundColor: c.backgroundElement }]}
      onPress={() =>
        openTitle(router, {
          tmdbId: item.tmdbId,
          mediaType: item.mediaType,
          name: item.titleName,
        })
      }>
      <Image
        style={[styles.poster, large && styles.posterLarge]}
        source={{ uri: imageUrl(item.posterPath, 'w185') ?? undefined }}
        contentFit="cover"
        transition={150}
      />
      <ThemedView style={styles.rowText}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {item.titleName}
        </ThemedText>
        {item.subtitle ? (
          <ThemedText type="small" numberOfLines={1}>
            {item.subtitle}
          </ThemedText>
        ) : null}
        <ThemedText type="small" style={styles.date}>
          {formatDate(item.watched_at)}
        </ThemedText>
      </ThemedView>
      {onEdit && (
        <Pressable
          hitSlop={8}
          style={styles.editBtn}
          onPress={() => onEdit(item)}
          accessibilityRole="button"
          accessibilityLabel="Change the date this was watched">
          <IconSymbol name="calendar" size={18} tintColor={c.textSecondary} />
        </Pressable>
      )}
    </PressScale>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: PlaceholderBg,
  },
  posterLarge: { width: 52, height: 78 },
  rowText: { flex: 1, gap: Spacing.half, backgroundColor: 'transparent' },
  date: { opacity: 0.6 },
  editBtn: { alignSelf: 'center', paddingHorizontal: Spacing.two },
});
