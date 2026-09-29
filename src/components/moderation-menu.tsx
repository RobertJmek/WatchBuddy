import { useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { useActionMenu, type MenuAction } from '@/components/action-menu';
import { hapticFailure, hapticSuccess, hapticUndo } from '@/lib/haptics';
import {
  REPORT_REASONS,
  blockUser,
  invalidateAfterReport,
  invalidateBlockScoped,
  reportContent,
  unblockUser,
  type ReportReason,
  type ReportTarget,
} from '@/lib/moderation';

/** Who a moderation action is about — enough to name them in a prompt. */
export type ModerationSubject = { id: string; username: string | null; name: string };

/** "@handle" when there is one, else the display name — how a menu row names a person. */
export function handleOf(u: { username: string | null; name: string }) {
  return u.username ? `@${u.username}` : u.name;
}

/**
 * Report and Block, wired the same way on every surface that offers them (a
 * reply, a review card, a review row, a profile). ADR 0025.
 *
 * Render the returned `menu` once in the screen; the rest are plain functions.
 * Each success buzzes through `haptics.ts` and each failure says so — a report
 * that silently failed would be worse than none.
 *
 * `onDone` runs after the action landed, for a screen that has to react (the
 * thread closes when the review it shows has just been hidden).
 */
export function useModerationMenu() {
  const queryClient = useQueryClient();
  const { open, menu } = useActionMenu();

  async function submitReport(
    target: ReportTarget,
    id: string,
    reason: ReportReason,
    onDone?: () => void,
  ) {
    try {
      await reportContent(target, id, reason);
    } catch {
      hapticFailure();
      Alert.alert('Could not send the report. Try again.');
      return;
    }
    hapticSuccess();
    // A profile report hides nothing — there is nothing to refetch.
    if (target !== 'user') invalidateAfterReport(queryClient);
    Alert.alert(
      'Thanks for the report',
      target === 'user'
        ? "We'll take a look. You can also block them so you no longer see each other."
        : "We'll take a look. It's hidden for you now.",
    );
    onDone?.();
  }

  /**
   * Ask why, then file. Called from another menu's action, so the first sheet is
   * still closing: the second one waits a beat, or iOS declines to present it.
   */
  function report(target: ReportTarget, id: string, onDone?: () => void) {
    setTimeout(() => {
      open(
        REPORT_REASONS.map(
          (r): MenuAction => ({
            label: r.label,
            run: () => void submitReport(target, id, r.value, onDone),
          }),
        ),
        'Why are you reporting this?',
      );
    }, 300);
  }

  function block(user: ModerationSubject, onDone?: () => void) {
    Alert.alert(
      `Block ${handleOf(user)}?`,
      "You won't see each other's reviews, replies or activity, and you'll stop following each other. You can unblock any time from Edit profile → Blocked accounts.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(user.id);
            } catch {
              hapticFailure();
              Alert.alert('Could not block. Try again.');
              return;
            }
            hapticSuccess();
            invalidateBlockScoped(queryClient);
            onDone?.();
          },
        },
      ],
    );
  }

  async function unblock(user: ModerationSubject, onDone?: () => void) {
    try {
      await unblockUser(user.id);
    } catch {
      hapticFailure();
      Alert.alert('Could not unblock. Try again.');
      return;
    }
    hapticUndo();
    invalidateBlockScoped(queryClient);
    onDone?.();
  }

  return { menu, openMenu: open, report, block, unblock };
}
