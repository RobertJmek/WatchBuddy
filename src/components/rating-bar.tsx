import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { IconSymbol } from '@/components/icon-symbol';
import { ImpliedWatchNote, useImpliedWatch } from '@/components/implied-watch-note';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticFailure, hapticSuccess, hapticTick, hapticUndo } from '@/lib/haptics';
import { keys } from '@/lib/keys';
import {
  entityTypeFor,
  getRating,
  removeRating,
  setRating,
  type Rating,
} from '@/lib/ratings';

const ACTIVE = Accent;
const VALUES = Array.from({ length: 10 }, (_, i) => i + 1);

/** Matches the app's standard press spring (see `press-scale.tsx`). */
const SPRING = { damping: 20, stiffness: 300 };
const BUBBLE = 40;
/** Matches the server's limit (migration 0021). */
const REVIEW_MAX = 2000;

/**
 * One number on the scale. The whole cell is `flex: 1` so the ten cells divide
 * the row evenly — that's what makes the drag's x→value math line up with what
 * you see. The circle inside is capped at 30px so it stays a circle on wide
 * screens and shrinks on narrow ones instead of wrapping to a second row.
 */
function RatingChip({
  n,
  on,
  selected,
  active,
  onPress,
}: {
  n: number;
  on: boolean;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(active ? 1.4 : 1, SPRING);
    lift.value = withSpring(active ? -6 : 0, SPRING);
  }, [active, scale, lift]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: lift.value }],
  }));

  return (
    <Pressable
      style={styles.cell}
      onPress={onPress}
      accessibilityRole="button"
      // A tap on the current value clears it, so that's what the label has to
      // promise — announcing "Rate 7" on the button that erases your 7 is worse
      // than no label.
      accessibilityLabel={selected ? `Clear rating of ${n}` : `Rate ${n} out of 10`}
      accessibilityState={{ selected }}>
      <Animated.View
        style={[
          styles.num,
          on && styles.numOn,
          selected && styles.numSelected,
          animated,
        ]}>
        <ThemedText type="small" style={on ? styles.numTextOn : undefined}>
          {n}
        </ThemedText>
      </Animated.View>
    </Pressable>
  );
}

export function RatingBar({
  titleId,
  tmdbId,
  mediaType,
}: {
  titleId: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
}) {
  const entityType = entityTypeFor(mediaType);
  const queryClient = useQueryClient();
  const router = useRouter();
  const c = useTheme();
  const textColor = c.text;
  const borderColor = c.border;

  // A query, not local state: the title screen stays mounted under the review
  // thread, and a copy loaded once here would write an edited or deleted review
  // straight back on the next score change. The thread invalidates this key.
  const ratingKey = keys.myRating(titleId);
  const ratingQ = useQuery({
    queryKey: ratingKey,
    queryFn: () => getRating(entityType, titleId),
  });
  const rating = ratingQ.data ?? null;
  const value = rating?.value ?? null;
  const review = rating?.review ?? '';
  const likeCount = rating?.likeCount ?? 0;
  const ratingId = rating?.id ?? null;

  const [draft, setDraft] = useState(''); // edit buffer
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Drag-to-rate: the row's measured width turns a finger's x into a value.
  const [rowWidth, setRowWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const lastHovered = useRef<number | null>(null);
  const cellWidth = rowWidth / VALUES.length;

  const implied = useImpliedWatch({ id: titleId, tmdbId, mediaType });

  function valueFromX(x: number) {
    if (!cellWidth) return null;
    const i = Math.floor(x / cellWidth);
    return VALUES[Math.min(VALUES.length - 1, Math.max(0, i))];
  }

  /** Ticks only when the finger crosses into a new number, not every frame. */
  function hover(x: number) {
    const n = valueFromX(x);
    if (n == null || n === lastHovered.current) return;
    lastHovered.current = n;
    setHovered(n);
    hapticTick();
  }

  // Horizontal-only: the title screen is a vertical ScrollView, so a drag that
  // starts on the scale but goes up/down must scroll the page instead.
  // `runOnJS` keeps the callbacks on the JS thread — there are at most ten state
  // updates in a full drag, so there's nothing to gain from a worklet.
  /* eslint-disable react-hooks/refs -- the builder is constructed during
     render, but its callbacks only ever run from the gesture, which is
     exactly when reading `lastHovered.current` is correct. */
  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .runOnJS(true)
    .onStart((e) => hover(e.x))
    .onUpdate((e) => hover(e.x))
    .onEnd((e) => {
      const n = valueFromX(e.x);
      if (n != null) choose(n, { fromDrag: true });
    })
    .onFinalize(() => {
      lastHovered.current = null;
      setHovered(null);
    });
  /* eslint-enable react-hooks/refs */

  /**
   * `fromDrag` = the value was released under a finger swiping the scale, not
   * tapped. A drag never clears: stopping on the number you already have is far
   * too easy to do by accident, so it's a no-op instead of wiping your rating.
   * A tap on the current value still clears it — after a confirmation when
   * there is a review, because clearing deletes the rating row and, with it,
   * the review, its likes and every reply other people wrote to it.
   */
  function choose(n: number, opts?: { fromDrag?: boolean }) {
    if (opts?.fromDrag && n === value) return; // nothing to write
    if (n === value && (review || likeCount > 0)) {
      Alert.alert(
        'Remove your rating?',
        'Your review, its likes and every reply to it will be deleted too.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => void commit(n) },
        ],
      );
      return;
    }
    void commit(n, opts);
  }

  async function commit(n: number, opts?: { fromDrag?: boolean }) {
    const clear = n === value;
    const previous = rating;
    // Optimistic.
    const optimistic: Rating | null = clear
      ? null
      : { id: ratingId ?? '', value: n, review: rating?.review ?? null, likeCount };
    queryClient.setQueryData(ratingKey, optimistic);
    if (clear) {
      setEditing(false);
      hapticUndo();
    } else if (opts?.fromDrag) {
      hapticSuccess(); // the drag already ticked its way here; this is the landing
    } else {
      hapticTick();
    }
    try {
      if (clear) await removeRating(entityType, titleId);
      else await setRating(entityType, titleId, n, review);
      queryClient.invalidateQueries({ queryKey: ratingKey });
      queryClient.invalidateQueries({ queryKey: keys.stats() });
      queryClient.invalidateQueries({ queryKey: keys.titleRatings(titleId) });
      // The library carries the viewer's own rating (it's a filter axis), so a
      // changed or cleared value has to reach it. Only this path matters —
      // editing a review's text keeps the value, so it can't move the axis.
      queryClient.invalidateQueries({ queryKey: keys.library() });
      // A first rating means you've seen it (ADR 0024). Changing or clearing a
      // rating never logs anything, and neither does rating a show you've
      // already started — hence `onlyIfUntouched`.
      if (!clear && previous == null) void implied.mark({ onlyIfUntouched: true });
    } catch {
      queryClient.setQueryData(ratingKey, previous);
      hapticFailure();
    }
  }

  function startEditing() {
    setDraft(review);
    setEditing(true);
  }

  async function saveReview() {
    if (value == null || saving) return;
    setSaving(true);
    try {
      await setRating(entityType, titleId, value, draft);
      const text = draft.trim() || null;
      queryClient.setQueryData<Rating | null>(ratingKey, (r) =>
        r ? { ...r, review: text } : r,
      );
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ratingKey });
      queryClient.invalidateQueries({ queryKey: keys.titleRatings(titleId) });
      hapticSuccess();
    } catch {
      hapticFailure();
    } finally {
      setSaving(false);
    }
  }

  if (ratingQ.isLoading) return <ActivityIndicator style={{ alignSelf: 'flex-start' }} />;

  // Nothing loaded and the load failed: show no scale at all. A scale here would
  // read as "not rated", and the first tap would overwrite the real rating and
  // erase its review.
  if (ratingQ.data === undefined) {
    return (
      <View style={styles.container}>
        <ThemedText type="meta" style={{ color: c.textSecondary }}>
          Your rating
        </ThemedText>
        <View style={styles.actions}>
          <ThemedText type="small" style={{ color: c.textSecondary }}>
            Couldn&apos;t load your rating.
          </ThemedText>
          <Pressable
            onPress={() => void ratingQ.refetch()}
            hitSlop={8}
            accessibilityRole="button">
            <ThemedText type="small" style={styles.saveText}>
              Retry
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  // While dragging, the scale previews the value under the finger: the fill
  // follows it live instead of waiting for the release to commit.
  const shown = hovered ?? value;

  return (
    <View style={styles.container}>
      <ThemedText type="meta" style={{ color: c.textSecondary }}>
        Your rating
      </ThemedText>
      <View style={styles.scaleWrap}>
        {hovered != null && cellWidth > 0 && (
          <View
            pointerEvents="none"
            style={[
              styles.bubble,
              { left: cellWidth * (hovered - 1) + cellWidth / 2 - BUBBLE / 2 },
            ]}>
            <ThemedText style={styles.bubbleText}>{hovered}</ThemedText>
          </View>
        )}
        <GestureDetector gesture={pan}>
          <View
            style={styles.scale}
            onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
            {VALUES.map((n) => (
              <RatingChip
                key={n}
                n={n}
                on={shown != null && n <= shown}
                selected={n === shown}
                active={n === hovered}
                onPress={() => choose(n)}
              />
            ))}
          </View>
        </GestureDetector>
      </View>

      <ImpliedWatchNote note={implied.note} onUndo={implied.undo} />

      {value != null &&
        (editing ? (
          <>
            <TextInput
              style={[
                styles.review,
                {
                  color: textColor,
                  borderColor,
                  backgroundColor: c.backgroundElement,
                },
              ]}
              placeholder="Write a review…"
              placeholderTextColor={c.textSecondary}
              maxLength={REVIEW_MAX}
              autoFocus
              multiline
              value={draft}
              onChangeText={setDraft}
            />
            <View style={styles.actions}>
              <Pressable
                style={[styles.saveBtn, saving && styles.busy]}
                onPress={saveReview}
                disabled={saving}
                accessibilityRole="button"
                accessibilityState={{ disabled: saving, busy: saving }}>
                <ThemedText type="small" style={styles.saveText}>
                  Save
                </ThemedText>
              </Pressable>
              <Pressable onPress={() => setEditing(false)} disabled={saving}>
                <ThemedText type="small">Cancel</ThemedText>
              </Pressable>
            </View>
          </>
        ) : review ? (
          <Pressable
            style={({ pressed }) => [
              styles.reviewCard,
              { backgroundColor: c.backgroundElement },
              pressed && styles.busy,
            ]}
            onPress={startEditing}
            accessibilityRole="button"
            accessibilityHint="Edits your review">
            <ThemedText type="meta" style={{ color: c.textSecondary }}>
              Your review
            </ThemedText>
            <ThemedText style={styles.reviewText}>{review}</ThemedText>
            <View style={styles.cardFooter}>
              <View style={styles.editRow}>
                <IconSymbol name="pencil" size={13} tintColor={ACTIVE} />
                <ThemedText type="small" style={{ color: ACTIVE }}>
                  Edit
                </ThemedText>
              </View>
              {likeCount > 0 && (
                <Pressable
                  hitSlop={10}
                  // Long-press: who liked my review.
                  onLongPress={() =>
                    ratingId &&
                    router.push({
                      pathname: '/review/[ratingId]/likes',
                      params: { ratingId },
                    })
                  }
                  style={styles.editRow}
                  accessibilityRole="button"
                  accessibilityLabel={`${likeCount} likes`}
                  accessibilityHint="Opens the list of people who liked this">
                  <IconSymbol
                    name="heart"
                    size={13}
                    tintColor={c.textSecondary}
                  />
                  <ThemedText type="small" style={{ color: c.textSecondary }}>
                    {likeCount}
                  </ThemedText>
                </Pressable>
              )}
            </View>
          </Pressable>
        ) : (
          <Pressable onPress={startEditing}>
            <ThemedText type="small" style={styles.link}>
              ＋ Add review
            </ThemedText>
          </Pressable>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  scaleWrap: { position: 'relative' },
  // No wrap and no gap: ten equal `flex: 1` cells, so a finger's x maps straight
  // onto a value. Spacing lives inside the cell, around the circle.
  scale: { flexDirection: 'row', alignItems: 'center' },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.one,
  },
  num: {
    width: '100%',
    maxWidth: 30,
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: ACTIVE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sits above the row while dragging; absolute so it never shifts the layout.
  bubble: {
    position: 'absolute',
    top: -(BUBBLE + 10),
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: 12,
    backgroundColor: ACTIVE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  bubbleText: { color: AccentText, fontSize: 20, fontWeight: '700' },
  numOn: { backgroundColor: ACTIVE },
  numSelected: { borderWidth: 2, borderColor: AccentText },
  numTextOn: { color: AccentText },
  review: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  reviewText: { lineHeight: 21 },
  reviewCard: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.half,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  saveBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: ACTIVE,
  },
  busy: { opacity: 0.6 },
  saveText: { color: ACTIVE },
  link: { color: ACTIVE, marginTop: Spacing.half },
});
