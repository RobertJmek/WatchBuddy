import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Best-effort haptic feedback — the app's single entry point to `expo-haptics`.
 *
 * Two rules:
 *
 * 1. **Never import `expo-haptics` directly from a component.** `impactAsync` &
 *    friends throw *synchronously* when the native module isn't in the installed
 *    binary (a dev client older than the prebuild that added it). A bare
 *    `Haptics.impactAsync(...).catch(() => {})` only catches a rejected promise,
 *    so that throw propagates and swallows whatever action it was decorating.
 *    Every function here is fire-and-forget and cannot throw.
 * 2. **Fire on the optimistic moment** — the instant the UI changes, not after
 *    Supabase answers, or the buzz lands noticeably late. Where a write rolls
 *    back on failure, follow up with `hapticFailure()`.
 *
 * Android gets the semantic `performAndroidHapticsAsync` effects (a plain
 * `ImpactFeedbackStyle.Light` is close to imperceptible on most devices); iOS
 * gets the UIKit generators it's designed around.
 */

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

/** Runs a haptic without ever letting it break the caller. */
function fire(run: () => Promise<void>) {
  if (!supported) return;
  try {
    run().catch(() => {});
  } catch {
    // Native module missing → synchronous throw. Haptics are decoration; drop it.
  }
}

/** A light tick for stepping through choices: +1 episode, a status chip, a star. */
export function hapticTick() {
  fire(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick)
      : Haptics.selectionAsync(),
  );
}

/** A switch flipping: favorite, follow, like. */
export function hapticToggle(on: boolean) {
  fire(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(
          on ? Haptics.AndroidHaptics.Toggle_On : Haptics.AndroidHaptics.Toggle_Off,
        )
      : Haptics.impactAsync(
          on ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Soft,
        ),
  );
}

/** Something was committed: a watch logged, a review saved. */
export function hapticSuccess() {
  fire(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm)
      : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  );
}

/** Something was taken back: an undo, a removed watch. Softer than success. */
export function hapticUndo() {
  fire(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Toggle_Off)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
  );
}

/** A write failed and the optimistic UI rolled back. */
export function hapticFailure() {
  fire(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject)
      : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  );
}
