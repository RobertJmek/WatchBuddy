import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

/**
 * How long a cached query survives, in memory and on disk. Both halves need it:
 * `gcTime` alone keeps data in memory, but the persister throws away a stored
 * cache older than its own `maxAge` (24h by default) at the next cold open — so
 * without passing this to `persistOptions` too, offline browsing lasted a day.
 */
export const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 days

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep data long enough to persist for offline cold-opens.
      staleTime: 1000 * 60, // 1 minute
      gcTime: CACHE_MAX_AGE,
      retry: 1,
      refetchOnReconnect: true,
    },
  },
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'WATCHBUDDY_QUERY_CACHE',
});
