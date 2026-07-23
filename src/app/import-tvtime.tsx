import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Danger, PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { queryClient } from '@/lib/query';
import { imageUrl, searchTitles, type SearchResult } from '@/lib/tmdb';
import {
  ImportCancelled,
  resolveAll,
  runImport,
  type Resolution,
  type ResolveProgress,
} from '@/lib/tvtime/engine';
import { buildImportPlan, unzipExport } from '@/lib/tvtime/parse';
import type {
  ImportPlan,
  ImportProgress,
  ImportSummary,
  MatchOverride,
  UnresolvedItem,
} from '@/lib/tvtime/types';

// Manual matches survive a cancelled/killed run, so a re-import doesn't ask
// again. Keyed by the item's identity key (show nameKey / movie:{name}).
const OVERRIDES_KEY = 'wb:tvtime-import-overrides';

type Step =
  | { step: 'idle'; error: string | null }
  | { step: 'parsing' }
  | { step: 'resolving'; plan: ImportPlan; progress: ResolveProgress | null }
  | {
      step: 'matching';
      plan: ImportPlan;
      resolution: Resolution;
      queue: UnresolvedItem[];
      index: number;
    }
  | { step: 'confirm'; plan: ImportPlan; resolution: Resolution }
  | { step: 'importing'; plan: ImportPlan; progress: ImportProgress | null }
  | { step: 'done'; summary: ImportSummary };

const PHASE_LABEL: Record<ImportProgress['phase'], string> = {
  prefetch: 'Reading your existing history',
  shows: 'Adding shows to your library',
  episodes: 'Importing episode watches',
  rewatches: 'Importing rewatches',
  movies: 'Importing movies',
  favorites: 'Marking favorites',
};

async function loadOverrides(): Promise<Map<string, MatchOverride>> {
  try {
    const raw = await AsyncStorage.getItem(OVERRIDES_KEY);
    return new Map(raw ? Object.entries(JSON.parse(raw)) : []);
  } catch {
    return new Map();
  }
}

async function saveOverride(key: string, match: MatchOverride) {
  try {
    const raw = await AsyncStorage.getItem(OVERRIDES_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[key] = match;
    await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(all));
  } catch {
    // Best-effort persistence — the in-memory pick still applies to this run.
  }
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const c = useTheme();
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <View style={[styles.barTrack, { backgroundColor: c.border }]}>
      <View style={[styles.barFill, { width: `${pct}%` }]} />
    </View>
  );
}

/** One unresolved title: search results from the proxy, tap to match. */
function MatchCard({
  item,
  onPick,
  onSkip,
}: {
  item: UnresolvedItem;
  onPick: (match: MatchOverride) => void;
  onSkip: () => void;
}) {
  const c = useTheme();
  const [results, setResults] = useState<SearchResult[] | null>(null);

  useEffect(() => {
    let alive = true;
    setResults(null);
    const wanted = item.kind === 'show' ? 'tv' : 'movie';
    searchTitles(item.displayName.replace(/\s*\(\d{4}\)\s*$/, ''))
      .then((all) => {
        if (alive) setResults(all.filter((r) => r.media_type === wanted).slice(0, 8));
      })
      .catch(() => {
        if (alive) setResults([]);
      });
    return () => {
      alive = false;
    };
  }, [item]);

  return (
    <View style={[styles.matchCard, { borderColor: c.border }]}>
      <ThemedText type="subtitle">
        {item.displayName}
        {item.year ? ` (${item.year})` : ''}
      </ThemedText>
      <ThemedText type="small" style={{ color: c.textSecondary }}>
        {item.kind === 'show'
          ? 'We couldn’t match this show automatically. Pick the right one:'
          : 'We couldn’t match this movie automatically. Pick the right one:'}
      </ThemedText>
      {results === null ? (
        <ActivityIndicator style={{ marginVertical: Spacing.three }} />
      ) : results.length === 0 ? (
        <ThemedText type="small" style={{ color: c.textSecondary }}>
          No results found.
        </ThemedText>
      ) : (
        results.map((r) => (
          <Pressable
            key={`${r.media_type}-${r.tmdb_id}`}
            style={[styles.resultRow, { borderBottomColor: c.border }]}
            onPress={() => onPick({ tmdbId: r.tmdb_id, mediaType: r.media_type })}>
            <Image
              style={styles.resultPoster}
              source={{ uri: imageUrl(r.poster_path, 'w92') ?? undefined }}
              contentFit="cover"
            />
            <View style={styles.resultText}>
              <ThemedText type="smallBold" numberOfLines={2}>
                {r.title}
              </ThemedText>
              {r.release_date ? (
                <ThemedText type="small" style={{ color: c.textSecondary }}>
                  {r.release_date.slice(0, 4)}
                </ThemedText>
              ) : null}
            </View>
          </Pressable>
        ))
      )}
      <Button title="Skip this title" variant="outline" onPress={onSkip} />
    </View>
  );
}

export default function ImportTvTimeScreen() {
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

  async function pickZip() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/zip', 'application/x-zip-compressed'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    setState({ step: 'parsing' });
    try {
      const bytes = await new File(picked.assets[0].uri).bytes();
      const files = await unzipExport(bytes);
      const plan = buildImportPlan(files);
      await resolve(plan);
    } catch (e) {
      fail(e);
    }
  }

  async function resolve(plan: ImportPlan) {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ step: 'resolving', plan, progress: null });
    try {
      const overrides = await loadOverrides();
      const resolution = await resolveAll(plan, overrides, {
        signal: controller.signal,
        onProgress: (progress) => setState({ step: 'resolving', plan, progress }),
      });
      if (resolution.unresolved.length > 0) {
        setState({
          step: 'matching',
          plan,
          resolution,
          queue: resolution.unresolved,
          index: 0,
        });
      } else {
        setState({ step: 'confirm', plan, resolution });
      }
    } catch (e) {
      fail(e);
    }
  }

  function applyMatch(match: MatchOverride | null) {
    if (state.step !== 'matching') return;
    const { plan, resolution, queue, index } = state;
    const item = queue[index];
    if (match) {
      saveOverride(item.key, match);
      if (item.kind === 'show') resolution.shows.set(item.key, match);
      else resolution.movies.set(item.key, match);
    }
    if (index + 1 < queue.length) {
      setState({ step: 'matching', plan, resolution, queue, index: index + 1 });
    } else {
      setState({ step: 'confirm', plan, resolution });
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
      <Stack.Screen options={{ headerShown: true, title: 'Import TV Time' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {state.step === 'idle' && (
          <>
            <ThemedText type="subtitle">Bring your TV Time history</ThemedText>
            <ThemedText style={{ color: c.textSecondary }}>
              1. In TV Time, go to Profile → Settings → Privacy and tap “Request
              my data”.{'\n'}
              2. TV Time emails you a ZIP within a few hours.{'\n'}
              3. Save it to your phone, then pick it below.
            </ThemedText>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              Your shows, episodes, rewatches, movies and favorites are imported
              with their original watch dates. Running the import twice never
              creates duplicates, and it never changes anything already in your
              library.
            </ThemedText>
            {state.error ? (
              <ThemedText type="small" style={styles.error}>
                {state.error}
              </ThemedText>
            ) : null}
            <Button title="Choose ZIP" onPress={pickZip} />
          </>
        )}

        {state.step === 'parsing' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" />
            <ThemedText style={{ color: c.textSecondary }}>
              Reading your export…
            </ThemedText>
          </View>
        )}

        {state.step === 'resolving' && (
          <>
            <ThemedText type="subtitle">Matching titles</ThemedText>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              {state.progress
                ? `${state.progress.done}/${state.progress.total} · ${state.progress.label}`
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

        {state.step === 'matching' && (
          <>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              {`Unmatched title ${state.index + 1} of ${state.queue.length}`}
            </ThemedText>
            <MatchCard
              item={state.queue[state.index]}
              onPick={applyMatch}
              onSkip={() => applyMatch(null)}
            />
          </>
        )}

        {state.step === 'confirm' && (
          <>
            <ThemedText type="subtitle">Ready to import</ThemedText>
            <ThemedText style={{ color: c.textSecondary }}>
              {`${state.resolution.shows.size} shows · ${state.plan.episodeWatches.length} episode watches · ${state.plan.rewatches.length} rewatch records · ${state.plan.movies.length} movie records`}
            </ThemedText>
            {state.resolution.unresolved.length > 0 ? (
              <ThemedText type="small" style={{ color: c.textSecondary }}>
                {`${state.resolution.unresolved.length} titles stay unmatched and will be skipped.`}
              </ThemedText>
            ) : null}
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              This can take a few minutes. Keep the app open.
            </ThemedText>
            <Button title="Start import" onPress={startImport} />
          </>
        )}

        {state.step === 'importing' && (
          <>
            <ThemedText type="subtitle">Importing…</ThemedText>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              {state.progress
                ? `${PHASE_LABEL[state.progress.phase]}${state.progress.label ? ` · ${state.progress.label}` : ''}`
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

        {state.step === 'done' && (
          <>
            <ThemedText type="subtitle">Import complete 🎉</ThemedText>
            <ThemedText style={{ color: c.textSecondary }}>
              {`Shows: ${state.summary.showsImported} imported\n` +
                `Episodes: ${state.summary.firstWatchesInserted} watches + ${state.summary.rewatchesInserted} rewatches\n` +
                `Movies: ${state.summary.moviesInserted} watches\n` +
                `Favorites: ${state.summary.favoritesSet} marked`}
            </ThemedText>
            {state.summary.firstWatchesSkipped +
              state.summary.rewatchesSkipped +
              state.summary.moviesSkipped >
            0 ? (
              <ThemedText type="small" style={{ color: c.textSecondary }}>
                {`${
                  state.summary.firstWatchesSkipped +
                  state.summary.rewatchesSkipped +
                  state.summary.moviesSkipped
                } records were already in your history and were skipped.`}
              </ThemedText>
            ) : null}
            {state.summary.skippedTitles.length > 0 ? (
              <ThemedText type="small" style={{ color: c.textSecondary }}>
                {`Skipped titles: ${state.summary.skippedTitles.join(', ')}`}
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
  matchCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultPoster: {
    width: 40,
    height: 60,
    borderRadius: 4,
    backgroundColor: PlaceholderBg,
  },
  resultText: { flex: 1, gap: 2 },
});
