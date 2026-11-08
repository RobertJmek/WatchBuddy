import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { BarButton } from '@/components/bottom-bar';
import { Intro } from '@/components/intro';
import { ImportBusy, ImportRunning, useImportRun } from '@/components/import-steps';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticFailure, hapticSuccess } from '@/lib/haptics';
import { importErrorMessage } from '@/lib/import-core/run';
import { queryClient } from '@/lib/query';
import { parseExport, WbImportParseError } from '@/lib/wb-import/parse';
import { useBottomGap } from '@/hooks/use-bottom-gap';
import {
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

export default function ImportWatchBuddyScreen() {
  const bottomGap = useBottomGap();
  const c = useTheme();
  const [state, setState] = useState<Step>({ step: 'idle', error: null });
  const run = useImportRun();

  // A cancel has no message, and gets no buzz either.
  const fail = (e: unknown) => {
    const error = importErrorMessage(e);
    if (error) hapticFailure();
    setState({ step: 'idle', error });
  };

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
    const signal = run.start();
    setState({ step: 'resolving', plan, progress: null });
    try {
      const resolution = await resolvePlan(plan, {
        signal,
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
    const signal = run.start();
    setState({ step: 'importing', plan, progress: null });
    try {
      const summary = await runImport(plan, resolution, {
        signal,
        onProgress: (progress) => setState({ step: 'importing', plan, progress }),
      });
      // The import bypassed the app's mutation paths — refresh everything.
      queryClient.invalidateQueries();
      hapticSuccess();
      setState({ step: 'done', summary });
    } catch (e) {
      // Partial writes are safe: a re-run prefetches and skips them.
      fail(e);
    }
  }

  return (
    <ThemedView style={styles.container}>
      {/* No header title: each phase's Intro is the title (ADR 0030). */}
      <Stack.Screen options={{ headerShown: true, title: '' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomGap }]}>
        {state.step === 'idle' && (
          <>
            <Intro
              title="Import WatchBuddy"
              body={
                <>
                  Pick a WatchBuddy export (the JSON from Export your data). It may be
                  someone else’s: its watch history is added to{' '}
                  <ThemedText style={styles.strong}>your account, as your own</ThemedText>.
                </>
              }
            />
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              Only episode and movie watches are imported, with their original
              dates. It never changes your library or ratings, and running it twice
              never creates duplicates.
            </ThemedText>
            {state.error ? (
              <ThemedText type="small" themeColor="danger">
                {state.error}
              </ThemedText>
            ) : null}
            <BarButton title="Choose export file" onPress={pickJson} />
          </>
        )}

        {state.step === 'parsing' && <ImportBusy label="Reading the export…" />}

        {state.step === 'resolving' && (
          <ImportRunning
            title="Matching titles"
            detail={state.progress && `${state.progress.done}/${state.progress.total}`}
            progress={state.progress}
            onCancel={run.cancel}
          />
        )}

        {state.step === 'confirm' && (
          <>
            <Intro
              title="Ready to import"
              body={`${state.plan.showCount} shows · ${state.plan.episodeWatches.length} episode watches · ${state.plan.movieCount} movies · ${state.plan.movieWatches.length} movie watches`}
            />
            {state.resolution.unresolved > 0 ? (
              <ThemedText type="small" style={{ color: c.textSecondary }}>
                {`${state.resolution.unresolved} titles couldn’t be found and will be skipped.`}
              </ThemedText>
            ) : null}
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              These watches will be saved under your account as your own. This can
              take a few minutes — keep the app open.
            </ThemedText>
            <BarButton title="Yes, import as mine" onPress={startImport} />
          </>
        )}

        {state.step === 'importing' && (
          <ImportRunning
            title="Importing…"
            detail={state.progress && PHASE_LABEL[state.progress.phase]}
            progress={state.progress}
            onCancel={run.cancel}
          />
        )}

        {state.step === 'done' && (
          <>
            <Intro
              title="Import complete"
              body={
                `Episodes: ${state.summary.episodeWatchesInserted} watches added\n` +
                `Movies: ${state.summary.movieWatchesInserted} watches added`
              }
            />
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
  strong: { fontFamily: Type.semibold },
  // The tutorial-card measures: 24pt sides; the Intro sits 32 above the rest.
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, gap: Spacing.three },
});
