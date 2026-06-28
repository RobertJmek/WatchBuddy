import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
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
  const scheme = useColorScheme();
  const textColor = scheme === 'dark' ? '#fff' : '#000';
  const borderColor = scheme === 'dark' ? '#444' : '#ccc';

  const [value, setValue] = useState<number | null>(null);
  const [review, setReview] = useState(''); // saved review
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
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <ActivityIndicator style={{ alignSelf: 'flex-start' }} />;

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold">Your rating</ThemedText>
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
              style={[styles.review, { color: textColor, borderColor }]}
              placeholder="Write a review…"
              placeholderTextColor={borderColor}
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
          <Pressable onPress={startEditing}>
            <ThemedText style={styles.reviewText}>{review}</ThemedText>
            <ThemedText type="small" style={styles.link}>
              Edit review
            </ThemedText>
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
  numSelected: { borderWidth: 2, borderColor: '#fff' },
  numTextOn: { color: '#fff' },
  review: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  reviewText: { lineHeight: 21 },
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
