import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Accent } from '@/constants/theme';
import { getFavorite, setFavorite } from '@/lib/library';

/** Heart toggle for the title detail header — filled teal when favorited. */
export function FavoriteButton({ titleId }: { titleId: string }) {
  const queryClient = useQueryClient();
  const [fav, setFav] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getFavorite(titleId)
      .then((f) => active && setFav(f))
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [titleId]);

  async function toggle() {
    if (saving || loading) return;
    const next = !fav;
    setFav(next); // optimistic
    setSaving(true);
    try {
      await setFavorite(titleId, next);
      queryClient.invalidateQueries({ queryKey: ['library'] });
    } catch {
      setFav(!next); // revert
    } finally {
      setSaving(false);
    }
  }

  return (
    <Pressable onPress={toggle} hitSlop={12} style={styles.btn}>
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
