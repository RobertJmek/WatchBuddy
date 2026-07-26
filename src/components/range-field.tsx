import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { normalizeRange, type Range } from '@/lib/library-filter';

/**
 * A min–max range as two numeric fields. Used for both interval axes of the
 * library filter — My rating (1–10) and Year (bounds derived from the library).
 *
 * Typed fields rather than a slider on purpose: the year domain spans decades,
 * and no thumb drag over ~50 steps lands on the year someone meant.
 *
 * The field is uncontrolled while you type and only reconciles on blur, so
 * clamping never fights the keyboard mid-number ("19" on the way to "1990"
 * would otherwise snap to the domain floor). `null` means the axis is off, and
 * is displayed as the full domain — committing the full domain gives `null`
 * back, which is what keeps "dragged it back to both ends" from counting as an
 * active filter.
 */
export function RangeField({
  label,
  hint,
  domain,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  domain: Range;
  value: Range | null;
  onChange: (next: Range | null) => void;
}) {
  const c = useTheme();
  const shown = value ?? domain;
  const [lo, setLo] = useState(String(shown[0]));
  const [hi, setHi] = useState(String(shown[1]));

  // Re-sync when the range changes from outside (Clear, or a removed chip).
  useEffect(() => {
    setLo(String(shown[0]));
    setHi(String(shown[1]));
  }, [shown[0], shown[1]]);

  function commit() {
    const parse = (raw: string, fallback: number) => {
      const n = Number(raw);
      return raw.trim() !== '' && Number.isFinite(n) ? n : fallback;
    };
    const next = normalizeRange(
      [parse(lo, domain[0]), parse(hi, domain[1])],
      domain,
    );
    onChange(next);
    // Reflect what was actually accepted — clamped, ordered, or reset to the
    // full domain when the axis went off.
    const effective = next ?? domain;
    setLo(String(effective[0]));
    setHi(String(effective[1]));
  }

  const field = [
    styles.field,
    { backgroundColor: c.backgroundElement, color: c.text },
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {hint && (
          <ThemedText type="small" style={{ color: c.textSecondary }}>
            {hint}
          </ThemedText>
        )}
      </View>
      <View style={styles.row}>
        <TextInput
          style={field}
          value={lo}
          onChangeText={setLo}
          onEndEditing={commit}
          onBlur={commit}
          keyboardType="number-pad"
          maxLength={4}
          returnKeyType="done"
          selectTextOnFocus
        />
        <ThemedText style={{ color: c.textSecondary }}>–</ThemedText>
        <TextInput
          style={field}
          value={hi}
          onChangeText={setHi}
          onEndEditing={commit}
          onBlur={commit}
          keyboardType="number-pad"
          maxLength={4}
          returnKeyType="done"
          selectTextOnFocus
        />
      </View>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  field: {
    flex: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 16,
    textAlign: 'center',
  },
});
