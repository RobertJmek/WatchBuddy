import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A pulsing placeholder block; size it via `style`. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [pulse]);
  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={[styles.block, { backgroundColor: c.backgroundElement }, style, animated]}
    />
  );
}

/** Placeholder for a PosterShelf: header bar + a row of poster-sized blocks. */
export function ShelfSkeleton() {
  return (
    <View style={styles.shelf}>
      <Skeleton style={styles.header} />
      <View style={styles.row}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} style={styles.poster} />
        ))}
      </View>
    </View>
  );
}

/** Placeholder for a diary-style row: thumbnail + two lines of text. */
export function RowSkeleton() {
  return (
    <View style={styles.listRow}>
      <Skeleton style={styles.thumb} />
      <View style={styles.lines}>
        <Skeleton style={styles.lineWide} />
        <Skeleton style={styles.lineNarrow} />
      </View>
    </View>
  );
}

/** Placeholder for a 3-column poster grid (library sections, watchlists). */
export function GridSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: rows * 3 }).map((_, i) => (
        <Skeleton key={i} style={styles.gridPoster} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    padding: Spacing.three,
  },
  gridPoster: { width: '31%', aspectRatio: 2 / 3, borderRadius: 4 },
  block: { borderRadius: 6 },
  shelf: { gap: Spacing.two },
  header: { width: 140, height: 20 },
  row: { flexDirection: 'row', gap: Spacing.two, overflow: 'hidden' },
  poster: { width: 110, height: 165, borderRadius: 4 },
  listRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
  },
  thumb: { width: 56, height: 84, borderRadius: 4 },
  lines: { flex: 1, gap: Spacing.one },
  lineWide: { height: 16, width: '70%' },
  lineNarrow: { height: 12, width: '45%' },
});
