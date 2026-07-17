import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { IconSymbol } from '@/components/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Accent, AccentText, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  entityTypeFor,
  getRating,
  removeRating,
  setRating,
} from '@/lib/ratings';

const ACTIVE = Accent;
const VALUES = Array.from({ length: 10 }, (_, i) => i + 1);

export function RatingBar({
  titleId,
  mediaType,
}: {
  titleId: string;
  mediaType: 'movie' | 'tv';
}) {
  const entityType = entityTypeFor(mediaType);
  const queryClient = useQueryClient();
  const c = useTheme();
  const textColor = c.text;
  const borderColor = c.border;

  const [value, setValue] = useState<number | null>(null);
  const [review, setReview] = useState(''); // saved review
  const [likeCount, setLikeCount] = useState(0);
  const [draft, setDraft] = useState(''); // edit buffer
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getRating(entityType, titleId)
      .then((r) => {
        if (!active || !r) return;
        setValue(r.value);
        setReview(r.review ?? '');
        setLikeCount(r.likeCount);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [titleId, entityType]);

  async function choose(n: number) {
    const clear = n === value;
    const previous = value;
    setValue(clear ? null : n); // optimistic
    if (clear) {
      setReview('');
      setEditing(false);
    }
    try {
      if (clear) await removeRating(entityType, titleId);
      else await setRating(entityType, titleId, n, review);
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['titleRatings', titleId] });
    } catch {
      setValue(previous);
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
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <ActivityIndicator style={{ alignSelf: 'flex-start' }} />;

  return (
    <View style={styles.container}>
      <ThemedText type="meta" style={{ color: c.textSecondary }}>
        Your rating
      </ThemedText>
      <View style={styles.scale}>
        {VALUES.map((n) => {
          const on = value != null && n <= value;
          const selected = n === value;
          return (
            <Pressable
              key={n}
              onPress={() => choose(n)}
              style={[
                styles.num,
                on && styles.numOn,
                selected && styles.numSelected,
              ]}>
              <ThemedText type="small" style={on ? styles.numTextOn : undefined}>
                {n}
              </ThemedText>
            </Pressable>
          );
        })}
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
                <View style={styles.editRow}>
                  <IconSymbol
                    name="heart"
                    size={13}
                    tintColor={c.textSecondary}
                  />
                  <ThemedText type="small" style={{ color: c.textSecondary }}>
                    {likeCount}
                  </ThemedText>
                </View>
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
  scale: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  num: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: ACTIVE,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
