import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticFailure, hapticSuccess, hapticTick, hapticUndo } from '@/lib/haptics';
import {
  entityTypeFor,
  getRating,
  removeRating,
  setRating,
} from '@/lib/ratings';

const ACTIVE = Accent;
const VALUES = Array.from({ length: 10 }, (_, i) => i + 1);

/** Matches the app's standard press spring (see `press-scale.tsx`). */
const SPRING = { damping: 20, stiffness: 300 };
const BUBBLE = 40;

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
    <Pressable style={styles.cell} onPress={onPress}>
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
  mediaType,
}: {
  titleId: string;
  mediaType: 'movie' | 'tv';
}) {
  const entityType = entityTypeFor(mediaType);
  const queryClient = useQueryClient();
  const router = useRouter();
  const c = useTheme();
  const textColor = c.text;
  const borderColor = c.border;

  const [value, setValue] = useState<number | null>(null);
  const [review, setReview] = useState(''); // saved review
  const [likeCount, setLikeCount] = useState(0);
  const [ratingId, setRatingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(''); // edit buffer
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Drag-to-rate: the row's measured width turns a finger's x into a value.
  const [rowWidth, setRowWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const lastHovered = useRef<number | null>(null);
  const cellWidth = rowWidth / VALUES.length;

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
  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .runOnJS(true)
    .onStart((e) => hover(e.x))
    .onUpdate((e) => hover(e.x))
    .onEnd((e) => {
      const n = valueFromX(e.x);
      if (n != null) void choose(n, { fromDrag: true });
    })
    .onFinalize(() => {
      lastHovered.current = null;
      setHovered(null);
    });

  useEffect(() => {
    let active = true;
    getRating(entityType, titleId)
      .then((r) => {
        if (!active || !r) return;
        setValue(r.value);
        setReview(r.review ?? '');
        setLikeCount(r.likeCount);
        setRatingId(r.id);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [titleId, entityType]);

  /**
   * `fromDrag` = the value was released under a finger swiping the scale, not
   * tapped. A drag never clears: stopping on the number you already have is far
   * too easy to do by accident, so it's a no-op instead of wiping your rating.
   * A tap on the current value still clears it.
   */
  async function choose(n: number, opts?: { fromDrag?: boolean }) {
    if (opts?.fromDrag && n === value) return; // nothing to write
    const clear = n === value;
    const previous = value;
    setValue(clear ? null : n); // optimistic
    if (clear) {
      setReview('');
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
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['titleRatings', titleId] });
      // The library carries the viewer's own rating (it's a filter axis), so a
      // changed or cleared value has to reach it. Only this path matters —
      // editing a review's text keeps the value, so it can't move the axis.
      queryClient.invalidateQueries({ queryKey: ['library'] });
    } catch {
      setValue(previous);
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
      setReview(draft.trim());
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['titleRatings', titleId] });
      hapticSuccess();
    } catch {
      hapticFailure();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <ActivityIndicator style={{ alignSelf: 'flex-start' }} />;

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
              autoFocus
              multiline
              value={draft}
              onChangeText={setDraft}
            />
            <View style={styles.actions}>
              <Pressable
                style={[styles.saveBtn, saving && styles.busy]}
                onPress={saveReview}
                disabled={saving}>
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
            onPress={startEditing}>
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
                  style={styles.editRow}>
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
