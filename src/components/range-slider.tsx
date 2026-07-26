import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticSuccess, hapticTick, hapticUndo } from '@/lib/haptics';
import { normalizeRange, type Range } from '@/lib/library-filter';

const THUMB = 24;
const TRACK_H = 4;

function sameRange(a: Range | null, b: Range | null) {
  if (a === null || b === null) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * A two-thumb range slider — the shape a price filter has in every online shop.
 * Used by both interval axes of the library filter: Year and My rating.
 *
 * Follows the drag idiom already in `rating-bar.tsx`: one `Gesture.Pan` with
 * `.runOnJS(true)` driving plain React state. A whole drag is a few dozen state
 * updates on integers, so there is nothing for a worklet to win, and the code
 * stays readable.
 *
 * Three behaviours worth knowing:
 *
 * - **A drag has to start horizontally** (`activeOffsetX` / `failOffsetY`).
 *   The sheet this lives in scrolls vertically, and a slider that grabs every
 *   touch would make the sheet unscrollable. The cost is that tapping the track
 *   does nothing — you drag a thumb.
 * - **`null` means the axis is off** and shows as the full domain. Releasing a
 *   thumb at either extreme hands `null` back up (via `normalizeRange`), which
 *   is what stops "I dragged it back" from counting as a filter.
 * - **The whole drag is narrated by haptics** (all via `lib/haptics.ts`, never
 *   `expo-haptics` directly): a tick on pickup, a tick per step crossed — never
 *   per frame, and never while a thumb is pinned against the other — then one
 *   of three endings on release. Committing a range confirms, dragging back to
 *   full span reads as an undo, and putting a thumb back where it was stays
 *   silent because nothing was committed.
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
  const [rowW, setRowW] = useState(0);

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

  // A thumb's own travel is the row minus its width, so its `left` runs
  // 0 → rowW - THUMB and never goes negative. That's what keeps the low thumb
  // inside the sheet instead of hanging off its left edge. The track is inset by
  // half a thumb on each side, so track-local x and thumb-local left are the
  // same coordinate space.
  const travel = Math.max(0, rowW - THUMB);

  function leftOf(v: number) {
    if (inert || travel <= 0) return 0;
    return ((v - domain[0]) / span) * travel;
  }

  /** Value under a finger at `x`, measured from the row's left edge. */
  function valueAt(x: number) {
    if (inert || travel <= 0) return domain[0];
    const t = Math.min(1, Math.max(0, (x - THUMB / 2) / travel));
    return Math.round(domain[0] + t * span);
  }

  /** The visual centre of a thumb, for deciding which one a touch grabs. */
  function centerOf(v: number) {
    return leftOf(v) + THUMB / 2;
  }

  /**
   * Move the grabbed thumb, ticking **only when the value actually changes** —
   * once per step crossed, not once per frame, and not at all while a thumb is
   * pinned against the other one. Same discipline as `rating-bar`'s `hover`,
   * which dedupes through a ref for the same reason.
   */
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
          ? e.x < centerOf(curLo)
            ? 'lo'
            : 'hi'
          : Math.abs(e.x - centerOf(curLo)) <= Math.abs(e.x - centerOf(curHi))
            ? 'lo'
            : 'hi';
      // The pickup tick. A grab usually lands on the thumb's own value, so
      // `moveTo` has nothing to report and would leave the gesture silent —
      // yet picking a thumb up is exactly the moment you want confirmed.
      hapticTick();
      moveTo(e.x);
    })
    .onUpdate((e) => moveTo(e.x))
    .onEnd(() => {
      const next = normalizeRange([live.current.lo, live.current.hi], domain);
      // Three different endings, three different feels — the same distinction
      // `rating-bar` draws between landing on a value, clearing one, and a drag
      // that changed nothing.
      if (sameRange(next, value)) {
        // Grabbed a thumb and put it back: nothing was committed, so no buzz.
      } else if (next === null) {
        hapticUndo(); // dragged back to full span — the axis just turned off
      } else {
        hapticSuccess();
      }
      onChange(next);
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

  const loLeft = leftOf(lo);
  const hiLeft = leftOf(hi);

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
        {/* The row is the full width and the measured coordinate space. Thumbs
            are its children (a child taller than its 4px parent gets clipped on
            Android) positioned with a non-negative `left`, so neither can hang
            outside the sheet. The track is inset by half a thumb on each side so
            its ends line up with where the thumbs can actually reach. */}
        <View
          style={styles.row}
          onLayout={(e) => setRowW(e.nativeEvent.layout.width)}>
          <View style={[styles.track, { backgroundColor: c.border }]}>
            <View
              style={[
                styles.fill,
                { left: loLeft, width: Math.max(0, hiLeft - loLeft) },
              ]}
            />
          </View>
          {travel > 0 && (
            <>
              <View
                style={[
                  styles.thumb,
                  { left: loLeft, borderColor: c.background },
                ]}
              />
              <View
                style={[
                  styles.thumb,
                  { left: hiLeft, borderColor: c.background },
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
  row: {
    height: THUMB,
    justifyContent: 'center',
    marginVertical: Spacing.two,
  },
  track: {
    height: TRACK_H,
    borderRadius: TRACK_H,
    marginHorizontal: THUMB / 2,
  },
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
