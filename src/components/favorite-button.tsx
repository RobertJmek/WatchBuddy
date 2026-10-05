import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Accent } from '@/constants/theme';
import { hapticFailure, hapticToggle } from '@/lib/haptics';
import { getFavorite, setFavorite } from '@/lib/library';
import { keys } from '@/lib/keys';

/** Heart toggle for the title detail header — filled teal when favorited. */
export function FavoriteButton({ titleId }: { titleId: string }) {
  const queryClient = useQueryClient();
  // A query, so removing the title from the library (which deletes the row and
  // the heart with it) can invalidate this and the header stays truthful.
  const favQ = useQuery({
    queryKey: keys.favorite(titleId),
    queryFn: () => getFavorite(titleId),
  });
  const fav = favQ.data ?? false;
  const loading = favQ.isLoading;
  const [saving, setSaving] = useState(false);

  async function toggle() {
    if (saving || loading) return;
    const next = !fav;
    queryClient.setQueryData(keys.favorite(titleId), next); // optimistic
    hapticToggle(next);
    setSaving(true);
    try {
      await setFavorite(titleId, next);
      queryClient.invalidateQueries({ queryKey: keys.library() });
      // Favoriting a title that isn't in the library creates its row (as
      // Watchlist) — the status chips on the same screen have to show it.
      queryClient.invalidateQueries({ queryKey: keys.libraryStatus(titleId) });
    } catch {
      queryClient.setQueryData(keys.favorite(titleId), !next); // revert
      hapticFailure();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Pressable
      onPress={toggle}
      hitSlop={12}
      style={styles.btn}
      accessibilityRole="button"
      accessibilityLabel={fav ? 'Remove from favorites' : 'Add to favorites'}
      accessibilityState={{ selected: fav, busy: saving || loading }}>
      <Text style={[styles.heart, { color: fav ? Accent : '#fff' }]}>
        {fav ? '♥' : '♡'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { paddingHorizontal: 4 },
  heart: { fontSize: 26, fontWeight: '600' },
});
