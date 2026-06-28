import { useRouter } from 'expo-router';
import { Button, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const router = useRouter();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedText type="title" style={styles.heading}>
          Profile
        </ThemedText>
        <ThemedText>Signed in as {session?.user.email}</ThemedText>

        <Pressable style={styles.link} onPress={() => router.push('/diary')}>
          <ThemedText type="subtitle">Diary</ThemedText>
          <ThemedText style={styles.chevron}>›</ThemedText>
        </Pressable>
        <Pressable style={styles.link} onPress={() => router.push('/stats')}>
          <ThemedText type="subtitle">Statistics</ThemedText>
          <ThemedText style={styles.chevron}>›</ThemedText>
        </Pressable>

        <Button title="Sign out" onPress={signOut} />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  heading: { marginTop: Spacing.three },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  chevron: { opacity: 0.4, fontSize: 20 },
});
