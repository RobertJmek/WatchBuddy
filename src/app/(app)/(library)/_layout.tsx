import { Stack } from 'expo-router';

/**
 * The Library tab is a nested Stack so pushed screens (notifications, and the
 * review thread reached from a notification) keep the native tab bar visible —
 * one tap jumps to any other tab instead of two Backs. `(library)` is a route
 * group, so the URLs stay `/` and `/notifications`; only the notification-path
 * thread gets its own `/thread/[ratingId]` route (see ADR 0005).
 */
export default function LibraryStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerBackButtonDisplayMode: 'minimal',
      }}
    />
  );
}
