import { Stack, router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { IconSymbol } from '@/components/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

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
  const c = useTheme();
  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Import your data' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="small" style={{ color: c.textSecondary }}>
          Where are you importing from?
        </ThemedText>
        {SOURCES.map((s) => (
          <Pressable
            key={s.route}
            style={[styles.card, { borderColor: c.border }]}
            onPress={() => router.push(s.route)}>
            <View style={styles.cardHeader}>
              <ThemedText type="subtitle">{s.title}</ThemedText>
              <IconSymbol name="chevron.right" size={18} tintColor={c.textSecondary} />
            </View>
            <ThemedText type="small" style={{ color: c.textSecondary }}>
              {s.description}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
