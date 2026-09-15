import { useRouter } from 'expo-router';
import {
  FlatList,
  StyleSheet,
  View,
  type RefreshControlProps,
} from 'react-native';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { FeedRow } from '@/components/feed-row';
import { Spacing } from '@/constants/theme';
import { type FeedItem } from '@/lib/feed';

/**
 * The **Activity** segment of the Feed tab: what the people you follow have
 * been doing. A dumb list — the screen above owns the infinite query, the
 * refresh control and the 24h seen-watermark (ADR 0006); this only renders
 * rows, asks for the next page, and says the right thing when there is nothing.
 *
 * `onEndReached` lives here and nowhere else, so the short Notifications list
 * can never trigger a `get_feed` page it has no use for.
 *
 * Stays mounted while hidden (`display: none`) so its scroll position and the
 * pages already loaded survive a trip to Notifications and back.
 */
export function ActivityList({
  items,
  isLoading,
  followsNobody,
  onEndReached,
  refreshControl,
  visible,
}: {
  items: FeedItem[];
  /** Suppresses the empty state on the very first load, before anything landed. */
  isLoading: boolean;
  /** Distinguishes "follow someone" from "your friends have been quiet". */
  followsNobody: boolean;
  onEndReached: () => void;
  refreshControl: React.ReactElement<RefreshControlProps>;
  visible: boolean;
}) {
  const router = useRouter();
  return (
    <View style={[styles.wrap, !visible && styles.hidden]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <FeedRow item={item} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.5}
        onEndReached={onEndReached}
        refreshControl={refreshControl}
        ListEmptyComponent={
          isLoading ? null : followsNobody ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="person.2"
                title="Your feed is empty"
                hint="Follow friends to see what they watch and rate."
              />
              <Button
                title="Find people"
                variant="outline"
                onPress={() => router.push('/explore')}
              />
            </View>
          ) : (
            <EmptyState
              icon="film"
              title="You're all caught up"
              hint="New activity from people you follow shows up here."
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  hidden: { display: 'none' },
  list: { gap: Spacing.two, paddingVertical: Spacing.two, flexGrow: 1 },
  emptyWrap: { gap: Spacing.four, paddingHorizontal: Spacing.four },
});
