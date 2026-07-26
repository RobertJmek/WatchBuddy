import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticSuccess, hapticTick } from '@/lib/haptics';
import { normalizeRange, type Range } from '@/lib/library-filter';

const THUMB = 24;
const TRACK_H = 4;

/**
 * A two-thumb range slider — the shape a price filter has in every online shop.
 * Used by both interval axes of the library filter: Year and My rating.
 *
 * Follows the drag idiom already in `rating-bar.tsx`: one `Gesture.Pan` with
 * `.runOnJS(true)` driving plain React state. A whole drag is a few dozen state
 * updates on integers, so there is nothing for a worklet to win, and the code
 * stays readable.
 *
 * Two behaviours worth knowing:
 *
 * - **A drag has to start horizontally** (`activeOffsetX` / `failOffsetY`).
 *   The sheet this lives in scrolls vertically, and a slider that grabs every
 *   touch would make the sheet unscrollable. The cost is that tapping the track
 *   does nothing — you drag a thumb.
 * - **`null` means the axis is off** and shows as the full domain. Releasing a
 *   thumb at either extreme hands `null` back up (via `normalizeRange`), which
 *   is what stops "I dragged it back" from counting as a filter.
 */
export function RangeSlider({
  label,
  hint,
  domain,
  value,
  onChange,
  formatEmpty,
}: {
  label: string;
  hint?: string;
  domain: Range;
  value: Range | null;
  onChange: (next: Range | null) => void;
  /** Readout when the axis is off — e.g. "Any", "All years". */
  formatEmpty: string;
}) {
  const c = useTheme();
  const shown = value ?? domain;
  const [lo, setLo] = useState(shown[0]);
  const [hi, setHi] = useState(shown[1]);
  const [trackW, setTrackW] = useState(0);

  // Re-sync when the range changes from outside (Clear, or a removed chip).
  useEffect(() => {
    setLo(shown[0]);
    setHi(shown[1]);
  }, [shown[0], shown[1]]);

  const span = domain[1] - domain[0];
  // A library whose titles all share one year has nothing to slide.
  const inert = span <= 0;

  // Live values the gesture reads and writes without waiting for a re-render.
  const live = useRef({ lo, hi });
  live.current = { lo, hi };
  const grabbed = useRef<'lo' | 'hi'>('lo');

  function xOf(v: number) {
    if (inert || trackW <= 0) return 0;
    return ((v - domain[0]) / span) * trackW;
  }

  function valueAt(x: number) {
    if (inert || trackW <= 0) return domain[0];
    const t = Math.min(1, Math.max(0, x / trackW));
    return Math.round(domain[0] + t * span);
  }

  function moveTo(x: number) {
    const v = valueAt(x);
    const { lo: curLo, hi: curHi } = live.current;
    if (grabbed.current === 'lo') {
      const next = Math.min(v, curHi);
      if (next === curLo) return;
      live.current.lo = next;
      setLo(next);
    } else {
      const next = Math.max(v, curLo);
      if (next === curHi) return;
      live.current.hi = next;
      setHi(next);
    }
    hapticTick();
  }

  const pan = Gesture.Pan()
    .enabled(!inert)
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .runOnJS(true)
    .onStart((e) => {
      const { lo: curLo, hi: curHi } = live.current;
      // Grab the nearer thumb. When they sit on top of each other, which side
      // of them the finger is on decides — so a collapsed range can be opened
      // again in either direction.
      grabbed.current =
        curLo === curHi
          ? e.x < xOf(curLo)
            ? 'lo'
            : 'hi'
          : Math.abs(e.x - xOf(curLo)) <= Math.abs(e.x - xOf(curHi))
            ? 'lo'
            : 'hi';
      moveTo(e.x);
    })
    .onUpdate((e) => moveTo(e.x))
    .onEnd(() => {
      const next = normalizeRange(
        [live.current.lo, live.current.hi],
        domain,
      );
      onChange(next);
      hapticSuccess();
    });

  // Always reads the live thumbs, so the number tracks the finger instead of
  // waiting for the release. Full span reads as "off" even mid-drag, which is
  // exactly what releasing there will commit.
  const full = lo === domain[0] && hi === domain[1];
  const readout = inert
    ? String(domain[0])
    : full
      ? formatEmpty
      : lo === hi
        ? String(lo)
        : `${lo} – ${hi}`;

  const fillLeft = xOf(lo);
  const fillWidth = Math.max(0, xOf(hi) - fillLeft);

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText
          type="small"
          style={{ color: full ? c.textSecondary : c.text }}>
          {readout}
        </ThemedText>
      </View>

      <GestureDetector gesture={pan}>
        {/* The thumbs are children of this gutter, not of the 4px track: a child
            taller than its parent is clipped on Android. The horizontal padding
            is half a thumb, so a thumb parked at either end still lands fully
            inside the gutter. */}
        <View style={styles.gutter}>
          <View
            style={[styles.track, { backgroundColor: c.border }]}
            onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
            <View style={[styles.fill, { left: fillLeft, width: fillWidth }]} />
          </View>
          {trackW > 0 && !inert && (
            <>
              <View
                style={[
                  styles.thumb,
                  { left: fillLeft - THUMB / 2, borderColor: c.background },
                ]}
              />
              <View
                style={[
                  styles.thumb,
                  { left: xOf(hi) - THUMB / 2, borderColor: c.background },
                ]}
              />
            </>
          )}
        </View>
      </GestureDetector>

      {hint && (
        <ThemedText type="small" style={{ color: c.textSecondary }}>
          {hint}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  gutter: {
    height: THUMB,
    justifyContent: 'center',
    paddingHorizontal: THUMB / 2,
    marginVertical: Spacing.two,
  },
  track: { height: TRACK_H, borderRadius: TRACK_H },
  fill: {
    position: 'absolute',
    height: TRACK_H,
    borderRadius: TRACK_H,
    backgroundColor: Accent,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: Accent,
    borderWidth: 2,
  },
});
