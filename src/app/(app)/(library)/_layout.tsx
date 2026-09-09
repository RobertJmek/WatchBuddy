import { Stack } from 'expo-router';

/**
 * The Library tab is a nested Stack so pushed screens keep the native tab bar
 * visible — one tap jumps to any other tab instead of two Backs. `(library)` is
 * a route group, so the URL stays `/`. Notifications used to live here (bell +
 * `/notifications` + a nested `/thread/[ratingId]`); they now live in the Feed
 * tab (see CONTEXT.md "Feed"), which supersedes ADR 0005's rationale. The
 * nested thread route went with them.
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
