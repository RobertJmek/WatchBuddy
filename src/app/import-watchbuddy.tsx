import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Danger, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { queryClient } from '@/lib/query';
import { parseExport, WbImportParseError } from '@/lib/wb-import/parse';
import {
  ImportCancelled,
  resolvePlan,
  runImport,
  type WbResolution,
} from '@/lib/wb-import/engine';
import type {
  WbImportPlan,
  WbImportProgress,
  WbImportSummary,
  WbResolveProgress,
} from '@/lib/wb-import/types';

type Step =
  | { step: 'idle'; error: string | null }
  | { step: 'parsing' }
  | { step: 'resolving'; plan: WbImportPlan; progress: WbResolveProgress | null }
  | { step: 'confirm'; plan: WbImportPlan; resolution: WbResolution }
  | { step: 'importing'; plan: WbImportPlan; progress: WbImportProgress | null }
  | { step: 'done'; summary: WbImportSummary };

const PHASE_LABEL: Record<WbImportProgress['phase'], string> = {
  prefetch: 'Reading your existing history',
  resolve: 'Matching titles',
  episodes: 'Importing episode watches',
  movies: 'Importing movies',
};

function ProgressBar({ done, total }: { done: number; total: number }) {
  const c = useTheme();
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <View style={[styles.barTrack, { backgroundColor: c.border }]}>
      <View style={[styles.barFill, { width: `${pct}%` }]} />
    </View>
  );
}

export default function ImportWatchBuddyScreen() {
  const c = useTheme();
  const [state, setState] = useState<Step>({ step: 'idle', error: null });
  const abortRef = useRef<AbortController | null>(null);
  // A multi-minute import shouldn't die because the screen locked.
  useKeepAwake();

  useEffect(() => () => abortRef.current?.abort(), []);

  const fail = (e: unknown) =>
    setState({
      step: 'idle',
      error:
        e instanceof ImportCancelled
          ? null
          : e instanceof Error
            ? e.message
            : 'Something went wrong. Please try again.',
    });

  async function pickJson() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/json'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    setState({ step: 'parsing' });
    try {
      const text = await new File(picked.assets[0].uri).text();
      const plan = parseExport(JSON.parse(text));
      await resolve(plan);
    } catch (e) {
      // A malformed JSON payload surfaces as a SyntaxError — make it friendly.
      if (e instanceof SyntaxError) {
        fail(new WbImportParseError('This file isn’t a valid WatchBuddy export.'));
        return;
      }
      fail(e);
    }
  }

  async function resolve(plan: WbImportPlan) {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ step: 'resolving', plan, progress: null });
    try {
      const resolution = await resolvePlan(plan, {
        signal: controller.signal,
        onProgress: (progress) => setState({ step: 'resolving', plan, progress }),
      });
      setState({ step: 'confirm', plan, resolution });
    } catch (e) {
      fail(e);
    }
  }

  async function startImport() {
    if (state.step !== 'confirm') return;
    const { plan, resolution } = state;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ step: 'importing', plan, progress: null });
    try {
      const summary = await runImport(plan, resolution, {
        signal: controller.signal,
        onProgress: (progress) => setState({ step: 'importing', plan, progress }),
      });
      // The import bypassed the app's mutation paths — refresh everything.
      queryClient.invalidateQueries();
      setState({ step: 'done', summary });
    } catch (e) {
      // Partial writes are safe: a re-run prefetches and skips them.
      fail(e);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Import WatchBuddy' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {state.step === 'idle' && (
          <>
            <ThemedText type="subtitle">Import a WatchBuddy export</ThemedText>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              Pick a WatchBuddy export file (the JSON from “Export your data”). This
              may be someone else’s export — its watch history will be added to{' '}
              <ThemedText type="smallBold">your account, as your own</ThemedText>.
            </ThemedText>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              Only episode and movie watches are imported, with their original
              dates. It never changes your library or ratings, and running it twice
              never creates duplicates.
            </ThemedText>
            {state.error ? (
              <ThemedText type="small" style={styles.error}>
                {state.error}
              </ThemedText>
            ) : null}
            <Button title="Choose export file" onPress={pickJson} />
          </>
        )}

        {state.step === 'parsing' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" />
            <ThemedText style={{ color: c.textSecondary }}>
              Reading the export…
            </ThemedText>
          </View>
        )}

        {state.step === 'resolving' && (
          <>
            <ThemedText type="subtitle">Matching titles</ThemedText>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              {state.progress
                ? `${state.progress.done}/${state.progress.total}`
                : 'Starting…'}
            </ThemedText>
            <ProgressBar
              done={state.progress?.done ?? 0}
              total={state.progress?.total ?? 1}
            />
            <Button
              title="Cancel"
              variant="outline"
              onPress={() => abortRef.current?.abort()}
            />
          </>
        )}

        {state.step === 'confirm' && (
          <>
            <ThemedText type="subtitle">Ready to import</ThemedText>
            <ThemedText style={{ color: c.textSecondary }}>
              {`${state.plan.showCount} shows · ${state.plan.episodeWatches.length} episode watches · ${state.plan.movieCount} movies · ${state.plan.movieWatches.length} movie watches`}
            </ThemedText>
            {state.resolution.unresolved > 0 ? (
              <ThemedText type="small" style={{ color: c.textSecondary }}>
                {`${state.resolution.unresolved} titles couldn’t be found and will be skipped.`}
              </ThemedText>
            ) : null}
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              These watches will be saved under your account as your own. This can
              take a few minutes — keep the app open.
            </ThemedText>
            <Button title="Yes, import as mine" onPress={startImport} />
          </>
        )}

        {state.step === 'importing' && (
          <>
            <ThemedText type="subtitle">Importing…</ThemedText>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              {state.progress ? PHASE_LABEL[state.progress.phase] : 'Starting…'}
            </ThemedText>
            <ProgressBar
              done={state.progress?.done ?? 0}
              total={state.progress?.total ?? 1}
            />
            <Button
              title="Cancel"
              variant="outline"
              onPress={() => abortRef.current?.abort()}
            />
          </>
        )}

        {state.step === 'done' && (
          <>
            <ThemedText type="subtitle">Import complete 🎉</ThemedText>
            <ThemedText style={{ color: c.textSecondary }}>
              {`Episodes: ${state.summary.episodeWatchesInserted} watches added\n` +
                `Movies: ${state.summary.movieWatchesInserted} watches added`}
            </ThemedText>
            {state.summary.episodeWatchesSkipped + state.summary.movieWatchesSkipped >
            0 ? (
              <ThemedText type="small" style={{ color: c.textSecondary }}>
                {`${
                  state.summary.episodeWatchesSkipped +
                  state.summary.movieWatchesSkipped
                } watches were already in your history and were skipped.`}
              </ThemedText>
            ) : null}
            {state.summary.episodeWatchesUnmatched + state.summary.titlesUnresolved >
            0 ? (
              <ThemedText type="small" style={{ color: c.textSecondary }}>
                {`${
                  state.summary.episodeWatchesUnmatched + state.summary.titlesUnresolved
                } records couldn’t be matched and were skipped.`}
              </ThemedText>
            ) : null}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  center: { alignItems: 'center', gap: Spacing.three, marginTop: Spacing.six },
  error: { color: Danger },
  barTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: Accent },
});
