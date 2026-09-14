import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AccentText, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticToggle } from '@/lib/haptics';

export type Segment<K extends string> = {
  key: K;
  label: string;
  /** A badge beside the label. `0` or omitted renders nothing. */
  count?: number;
  /**
   * What the badge *means*, spoken. A screen reader reading "Notifications, 3"
   * is told a number and not what it counts, so the caller owns the noun — this
   * component only knows it has a number to show. ADR 0018, rule 2.
   */
  countLabel?: string;
};

/**
 * A pill of mutually exclusive views over one screen — the Feed's
 * *Activity | Notifications*.
 *
 * It is a **view switch, not navigation**: both sides stay mounted behind it
 * (see `feed.tsx`), so pressing a segment costs nothing and loses no scroll
 * position. That is also why the role is `tab` rather than `button`: a screen
 * reader should announce it the way it announces a tab bar, one of N, with the
 * selected one marked.
 *
 * Pressing the segment that is already selected does nothing at all — no
 * `onChange`, no haptic. A buzz for a no-op is the same mistake the search
 * submit button made (ADR 0020).
 */
export function SegmentedControl<K extends string>({
  segments,
  value,
  onChange,
}: {
  segments: Segment<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  const c = useTheme();
  return (
    <View
      style={[styles.track, { backgroundColor: c.backgroundElement }]}
      accessibilityRole="tablist">
      {segments.map((s) => {
        const selected = s.key === value;
        const badge = s.count && s.count > 0 ? s.count : null;
        return (
          <Pressable
            key={s.key}
            style={[
              styles.segment,
              selected && { backgroundColor: c.backgroundSelected },
            ]}
            onPress={() => {
              if (selected) return;
              hapticToggle(true);
              onChange(s.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={
              badge && s.countLabel ? `${s.label}, ${s.countLabel}` : s.label
            }>
            <ThemedText
              type={selected ? 'smallBold' : 'small'}
              style={{ color: selected ? c.text : c.textSecondary }}>
              {s.label}
            </ThemedText>
            {badge ? (
              <View style={[styles.badge, { backgroundColor: c.tint }]}>
                <ThemedText type="small" style={styles.badgeText}>
                  {badge}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: Spacing.half,
    borderRadius: 999,
    marginBottom: Spacing.two,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  badge: {
    minWidth: 20,
    paddingHorizontal: Spacing.one,
    borderRadius: 999,
    alignItems: 'center',
  },
  badgeText: { color: AccentText, fontSize: 12, lineHeight: 18 },
});
