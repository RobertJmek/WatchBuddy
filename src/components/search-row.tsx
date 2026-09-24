import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { type useRouter } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { IconSymbol } from '@/components/icon-symbol';
import { PressScale } from '@/components/press-scale';
import { SwipeToLogRow } from '@/components/swipe-to-log-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, PlaceholderBg, Spacing } from '@/constants/theme';
import { openTitle } from '@/lib/navigation';
import { imageUrl, titleQueryOptions, type SearchResult } from '@/lib/tmdb';

function year(r: SearchResult) {
  return r.release_date ? r.release_date.slice(0, 4) : '—';
}

/** The swipe reveal's label and the custom action's label, from one place. */
function logLabel(item: SearchResult) {
  return item.media_type === 'tv' ? 'Log whole series' : 'Log watch';
}

/**
 * Memoized, and its props are shaped for it: the handlers take the item rather
 * than closing over it, so the parent can hold them stable across a keystroke.
 * Without that, every character typed into the search box re-rendered every
 * result row and its gesture handler.
 */
const ResultRow = memo(function ResultRow({
  item,
  bg,
  router,
  logged,
  pending,
  onUndoTap,
  onLog,
}: {
  item: SearchResult;
  bg: string;
  router: ReturnType<typeof useRouter>;
  /** True while this row is marked logged from a swipe this session. */
  logged: boolean;
  /** True while the DB write behind the optimistic ✓ hasn't landed yet. */
  pending: boolean;
  /** Tapping the checkmark undoes the session log (same as swipe-left). */
  onUndoTap: (item: SearchResult) => void;
  /** Swipe-right's action, offered here too — see the accessibility note below. */
  onLog: (item: SearchResult) => void;
}) {
  const queryClient = useQueryClient();
  return (
    <PressScale
      style={[styles.row, { backgroundColor: bg }]}
      // The swipe's two directions, as custom actions. They live on this
      // element and not on `SwipeToLogRow`'s child wrapper because a screen
      // reader only exposes the actions of the element it has *focused*, and
      // this `PressScale` is the row's focusable node. Logging is the one that
      // matters: unlike undo (the ✓) it has no tap equivalent here at all.
      accessibilityActions={
        logged
          ? [
              { name: 'log', label: logLabel(item) },
              { name: 'undo', label: 'Undo' },
            ]
          : [{ name: 'log', label: logLabel(item) }]
      }
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'log') onLog(item);
        else if (nativeEvent.actionName === 'undo') onUndoTap(item);
      }}
      // Warm the detail cache while the finger is still down.
      onPressIn={() =>
        queryClient.prefetchQuery(titleQueryOptions(item.tmdb_id, item.media_type))
      }
      onPress={() =>
        openTitle(router, {
          tmdbId: item.tmdb_id,
          mediaType: item.media_type,
          name: item.title,
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
      {logged ? (
        // Its own Pressable captures the touch, so tapping the check undoes
        // instead of opening the title (RN doesn't bubble to the parent).
        // Shown instantly on swipe (optimistic); dimmed until the write lands.
        <Pressable
          style={[styles.check, pending && styles.checkPending]}
          hitSlop={8}
          onPress={() => onUndoTap(item)}
          accessibilityRole="button"
          accessibilityLabel="Undo this watch"
          accessibilityState={{ busy: pending }}>
          <IconSymbol name="checkmark" size={18} tintColor={AccentText} />
        </Pressable>
      ) : null}
    </PressScale>
  );
});

/**
 * One search result: the swipe wrapper plus the row. Memoized as a unit so a
 * keystroke re-renders neither — `SwipeToLogRow`'s own memo can't help while
 * its `onLog` is a fresh closure, and the closure has to live somewhere.
 */
export const SearchRow = memo(function SearchRow({
  item,
  bg,
  router,
  logged,
  pending,
  onLog,
  onUndo,
}: {
  item: SearchResult;
  bg: string;
  router: ReturnType<typeof useRouter>;
  logged: boolean;
  pending: boolean;
  onLog: (item: SearchResult) => void;
  onUndo: (item: SearchResult) => void;
}) {
  return (
    <SwipeToLogRow
      onLog={() => onLog(item)}
      logLabel={logLabel(item)}
      longLog={item.media_type === 'tv'}
      onUndo={logged ? () => onUndo(item) : undefined}>
      <ResultRow
        item={item}
        bg={bg}
        router={router}
        logged={logged}
        pending={pending}
        onUndoTap={onUndo}
        onLog={onLog}
      />
    </SwipeToLogRow>
  );
});

const styles = StyleSheet.create({
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
  checkPending: { opacity: 0.55 },
});
