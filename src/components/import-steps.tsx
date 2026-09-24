import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * One AbortController per run, aborted when the screen unmounts, and the
 * screen kept awake — a multi-minute import shouldn't die because it locked.
 */
export function useImportRun() {
  const abortRef = useRef<AbortController | null>(null);
  useKeepAwake();
  useEffect(() => () => abortRef.current?.abort(), []);
  return {
    /** Start a run: returns the signal it should honour. */
    start() {
      abortRef.current = new AbortController();
      return abortRef.current.signal;
    },
    cancel() {
      abortRef.current?.abort();
    },
  };
}

/** The spinner shown while an export file is read. */
export function ImportBusy({ label }: { label: string }) {
  const c = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
      <ThemedText style={{ color: c.textSecondary }}>{label}</ThemedText>
    </View>
  );
}

/** A running phase: heading, what it's doing, a progress bar and Cancel. */
export function ImportRunning({
  title,
  detail,
  progress,
  onCancel,
}: {
  title: string;
  /** Shown once progress starts; "Starting…" before that. */
  detail: string | null;
  progress: { done: number; total: number } | null;
  onCancel: () => void;
}) {
  const c = useTheme();
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 1;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <>
      <ThemedText type="subtitle">{title}</ThemedText>
      <ThemedText type="small" style={{ color: c.textSecondary }}>
        {progress && detail ? detail : 'Starting…'}
      </ThemedText>
      <View style={[styles.barTrack, { backgroundColor: c.border }]}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <Button title="Cancel" variant="outline" onPress={onCancel} />
    </>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: Spacing.three, marginTop: Spacing.six },
  barTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: Accent },
});
