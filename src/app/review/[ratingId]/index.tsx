import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {
  KeyboardStickyView,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/icon-symbol';
import { RowSkeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, AccentText, PlaceholderBg, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { likeReview, unlikeReview } from '@/lib/ratings';
import {
  addReply,
  deleteReply,
  getReviewThread,
  type ReplyItem,
} from '@/lib/replies';

function nameOf(r: { display_name: string | null; username: string | null }) {
  return r.display_name?.trim() || (r.username ? `@${r.username}` : 'User');
}

function Avatar({ uri, name }: { uri: string | null; name: string }) {
  const initial = (name.replace('@', '') || '?').charAt(0).toUpperCase();
  return uri ? (
    <Image style={styles.avatar} source={{ uri }} contentFit="cover" transition={150} />
  ) : (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <ThemedText style={styles.avatarInitial}>{initial}</ThemedText>
    </View>
  );
}

export default function ReviewThreadScreen() {
  const c = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ratingId } = useLocalSearchParams<{ ratingId: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['reviewThread', ratingId],
    queryFn: () => getReviewThread(ratingId),
  });

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ReplyItem | null>(null);
  const [sending, setSending] = useState(false);
  const [menuFor, setMenuFor] = useState<ReplyItem | null>(null);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['reviewThread', ratingId] });
    queryClient.invalidateQueries({ queryKey: ['titleRatings'] });
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await addReply(ratingId, body, replyTo?.id);
      setDraft('');
      setReplyTo(null);
      refresh();
    } catch {
      Alert.alert('Could not post the reply. Try again.');
    } finally {
      setSending(false);
    }
  }

  // ⋯ menu on each reply: Reply / Copy / Delete (own). Native action sheet on
  // iOS, themed bottom-sheet Modal on Android.
  function actionsFor(item: ReplyItem) {
    const actions: { label: string; destructive?: boolean; run: () => void }[] = [
      { label: 'Reply', run: () => setReplyTo(item) },
      { label: 'Copy text', run: () => void Clipboard.setStringAsync(item.body) },
    ];
    if (item.isMine) {
      actions.push({
        label: 'Delete',
        destructive: true,
        run: () => confirmDelete(item),
      });
    }
    return actions;
  }

  function openReplyMenu(item: ReplyItem) {
    if (Platform.OS === 'ios') {
      const actions = actionsFor(item);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...actions.map((a) => a.label), 'Cancel'],
          cancelButtonIndex: actions.length,
          destructiveButtonIndex: item.isMine ? actions.length - 1 : undefined,
        },
        (i) => actions[i]?.run(),
      );
    } else {
      setMenuFor(item);
    }
  }

  function confirmDelete(item: ReplyItem) {
    Alert.alert('Delete this reply?', 'A "[deleted comment]" placeholder remains.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteReply(item.id);
            refresh();
          } catch {
            Alert.alert('Could not delete the reply.');
          }
        },
      },
    ]);
  }

  const review = data?.review;

  // Optimistic like state on the review card, seeded from (and re-synced to) the
  // server truth whenever the thread refetches — mirrors ReviewRow.
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  useEffect(() => {
    if (review) {
      setLiked(review.likedByMe);
      setLikes(review.likeCount);
    }
  }, [review?.likedByMe, review?.likeCount]);

  function openLikers() {
    if (likes === 0) return;
    router.push({
      pathname: '/review/[ratingId]/likes',
      params: { ratingId },
    });
  }

  async function toggleLike() {
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      if (next) await likeReview(ratingId);
      else await unlikeReview(ratingId);
      queryClient.invalidateQueries({ queryKey: ['titleRatings'] });
    } catch {
      setLiked(!next);
      setLikes((n) => n + (next ? -1 : 1));
    }
  }

  // The composer sticks above the keyboard; the list gets matching bottom
  // padding so the last replies can still scroll into view.
  const keyboard = useKeyboardState();
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Review' }} />
      <View style={styles.container}>
        {isLoading || !review ? (
          <View style={{ padding: Spacing.three, gap: Spacing.two }}>
            {[0, 1, 2].map((i) => (
              <RowSkeleton key={i} />
            ))}
          </View>
        ) : (
          <FlatList
            data={data.replies}
            keyExtractor={(r) => r.id}
            contentContainerStyle={[
              styles.list,
              keyboard.isVisible && { paddingBottom: keyboard.height + 72 },
            ]}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View
                style={[styles.reviewCard, { backgroundColor: c.backgroundElement }]}>
                <Pressable
                  style={styles.top}
                  onPress={() =>
                    router.push({
                      pathname: '/user/[id]',
                      params: { id: review.userId },
                    })
                  }>
                  <Avatar uri={review.avatar_url} name={nameOf(review)} />
                  <View style={styles.who}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {nameOf(review)}
                    </ThemedText>
                    {review.username && (
                      <ThemedText type="small" style={{ color: c.textSecondary }}>
                        @{review.username}
                      </ThemedText>
                    )}
                  </View>
                  <View style={[styles.score, { borderColor: c.glow }]}>
                    <ThemedText type="smallBold" style={{ color: c.glow }}>
                      {review.value}
                    </ThemedText>
                  </View>
                </Pressable>
                {review.review ? (
                  <ThemedText style={styles.text}>{review.review}</ThemedText>
                ) : null}
                {review.isMine ? (
                  // Own review: display-only counter (no self-likes); long-press
                  // opens the Liked-by list. Hidden entirely when there are none.
                  likes > 0 ? (
                    <View style={styles.reviewFooter}>
                      <Pressable
                        onLongPress={openLikers}
                        hitSlop={10}
                        style={styles.likeBtn}>
                        <IconSymbol name="heart" size={16} tintColor={c.textSecondary} />
                        <ThemedText type="small" style={{ color: c.textSecondary }}>
                          {likes}
                        </ThemedText>
                      </Pressable>
                    </View>
                  ) : null
                ) : (
                  <View style={styles.reviewFooter}>
                    <Pressable
                      onPress={toggleLike}
                      onLongPress={openLikers}
                      hitSlop={10}
                      style={styles.likeBtn}>
                      <IconSymbol
                        name="heart"
                        size={16}
                        tintColor={liked ? Accent : c.textSecondary}
                      />
                      {likes > 0 && (
                        <ThemedText
                          type="small"
                          style={{ color: liked ? Accent : c.textSecondary }}>
                          {likes}
                        </ThemedText>
                      )}
                    </Pressable>
                  </View>
                )}
              </View>
            }
            ListEmptyComponent={
              <ThemedText style={[styles.empty, { color: c.textSecondary }]}>
                No replies yet — start the conversation.
              </ThemedText>
            }
            renderItem={({ item }) => (
              <View style={[styles.reply, item.level === 1 && styles.replyNested]}>
                <Avatar uri={item.avatar_url} name={nameOf(item)} />
                <View style={styles.replyBody}>
                  <View style={styles.replyHeader}>
                    <ThemedText type="small" style={{ color: c.textSecondary }}>
                      {nameOf(item)}
                      {item.isMine ? ' · You' : ''}
                    </ThemedText>
                    {!item.isDeleted && (
                      <Pressable
                        hitSlop={10}
                        onPress={() => openReplyMenu(item)}>
                        <IconSymbol
                          name="ellipsis"
                          size={16}
                          tintColor={c.textSecondary}
                        />
                      </Pressable>
                    )}
                  </View>
                  {item.isDeleted ? (
                    <ThemedText
                      type="small"
                      style={[styles.deleted, { color: c.textSecondary }]}>
                      [deleted comment]
                    </ThemedText>
                  ) : (
                    <ThemedText style={styles.text}>
                      {item.replyToUsername ? (
                        <ThemedText type="smallBold" style={{ color: Accent }}>
                          @{item.replyToUsername}{' '}
                        </ThemedText>
                      ) : null}
                      {item.body}
                    </ThemedText>
                  )}
                </View>
              </View>
            )}
          />
        )}

        <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <SafeAreaView edges={['bottom']}>
          {replyTo && (
            <View style={[styles.replyingTo, { borderTopColor: c.border }]}>
              <ThemedText type="small" style={{ color: c.textSecondary }}>
                Replying to @{replyTo.username ?? nameOf(replyTo)}
              </ThemedText>
              <Pressable hitSlop={8} onPress={() => setReplyTo(null)}>
                <IconSymbol name="xmark" size={16} tintColor={c.textSecondary} />
              </Pressable>
            </View>
          )}
          <View style={styles.composer}>
            <TextInput
              style={[
                styles.input,
                { color: c.text, backgroundColor: c.backgroundElement },
              ]}
              placeholder="Add a reply…"
              placeholderTextColor={c.textSecondary}
              multiline
              value={draft}
              onChangeText={setDraft}
            />
            <Pressable
              onPress={send}
              disabled={!draft.trim() || sending}
              style={[
                styles.sendBtn,
                (!draft.trim() || sending) && styles.sendDisabled,
              ]}>
              <IconSymbol name="paperplane.fill" size={18} tintColor={AccentText} />
            </Pressable>
          </View>
        </SafeAreaView>
        </KeyboardStickyView>
      </View>

      {/* Android ⋯ menu: bottom sheet, dismissed by backdrop tap or Cancel. */}
      <Modal
        visible={menuFor != null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuFor(null)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: c.backgroundElement }]}
            onPress={(e) => e.stopPropagation()}>
            {menuFor &&
              actionsFor(menuFor).map((a) => (
                <Pressable
                  key={a.label}
                  style={({ pressed }) => [
                    styles.sheetRow,
                    pressed && { backgroundColor: c.backgroundSelected },
                  ]}
                  onPress={() => {
                    setMenuFor(null);
                    a.run();
                  }}>
                  <ThemedText
                    style={a.destructive ? styles.sheetDestructive : undefined}>
                    {a.label}
                  </ThemedText>
                </Pressable>
              ))}
            <View style={[styles.sheetDivider, { backgroundColor: c.border }]} />
            <Pressable
              style={({ pressed }) => [
                styles.sheetRow,
                pressed && { backgroundColor: c.backgroundSelected },
              ]}
              onPress={() => setMenuFor(null)}>
              <ThemedText style={{ color: c.textSecondary }}>Cancel</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.three },
  reviewCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  who: { flex: 1 },
  score: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { lineHeight: 21 },
  reviewFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: Spacing.half,
  },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  empty: { textAlign: 'center', marginTop: Spacing.four },
  reply: { flexDirection: 'row', gap: Spacing.two },
  replyNested: { marginLeft: Spacing.five + Spacing.two },
  replyBody: { flex: 1, gap: Spacing.half },
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deleted: { fontStyle: 'italic' },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: PlaceholderBg },
  avatarFallback: {
    backgroundColor: Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: AccentText, fontSize: 14, lineHeight: 18, fontWeight: '700' },
  replyingTo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.three,
  },
  input: {
    flex: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    maxHeight: 110,
  },
  sendBtn: {
    backgroundColor: Accent,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.5 },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    paddingVertical: Spacing.two,
    paddingBottom: Spacing.five,
  },
  sheetRow: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  sheetDestructive: { color: '#e5484d' },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.one,
  },
});
