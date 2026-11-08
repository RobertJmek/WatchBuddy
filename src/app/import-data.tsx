import { Stack, router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Intro } from '@/components/intro';
import { RowLink } from '@/components/row-link';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useBottomGap } from '@/hooks/use-bottom-gap';

type Source = {
  route: '/import-tvtime' | '/import-watchbuddy';
  title: string;
  description: string;
};

const SOURCES: Source[] = [
  {
    route: '/import-tvtime',
    title: 'TV Time',
    description:
      'Bring your shows, episodes, rewatches, movies and favorites from a TV Time export (ZIP).',
  },
  {
    route: '/import-watchbuddy',
    title: 'WatchBuddy',
    description:
      'Import the watch history from a WatchBuddy export (JSON) — including someone else’s.',
  },
];

export default function ImportDataScreen() {
  const bottomGap = useBottomGap();
  return (
    <ThemedView style={styles.container}>
      {/* No header title: the Intro is the title (ADR 0030). */}
      <Stack.Screen options={{ headerShown: true, title: '' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomGap }]}>
        <Intro title="Import your data" body="Where are you importing from?" />
        <View>
          {SOURCES.map((s) => (
            <RowLink
              key={s.route}
              label={s.title}
              note={s.description}
              onPress={() => router.push(s.route)}
            />
          ))}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // The tutorial-card measures: 24pt sides, 32 between groups.
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, gap: Spacing.five },
});
