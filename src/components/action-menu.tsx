import { useCallback, useState, type ReactElement } from 'react';
import { ActionSheetIOS, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Danger, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** One row of a ⋯ menu. */
export type MenuAction = { label: string; destructive?: boolean; run: () => void };

/**
 * The app's ⋯ menu: a native action sheet on iOS, a themed bottom-sheet `Modal`
 * on Android. Call `open(actions)` from a press handler and render `menu` once
 * anywhere in the screen — it is the Android sheet, and renders nothing on iOS.
 *
 * `title` is shown on the iOS sheet only; Android's sheet has no header, so a
 * caller that needs the question asked (the report reasons) should also put it
 * in its own labels.
 */
export function useActionMenu(): {
  open: (actions: MenuAction[], title?: string) => void;
  menu: ReactElement;
} {
  const [androidActions, setAndroidActions] = useState<MenuAction[] | null>(null);

  const open = useCallback((actions: MenuAction[], title?: string) => {
    if (Platform.OS === 'ios') {
      const di = actions.findIndex((a) => a.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options: [...actions.map((a) => a.label), 'Cancel'],
          cancelButtonIndex: actions.length,
          destructiveButtonIndex: di >= 0 ? di : undefined,
        },
        (i) => actions[i]?.run(),
      );
    } else {
      setAndroidActions(actions);
    }
  }, []);

  return {
    open,
    menu: <ActionSheet actions={androidActions} onClose={() => setAndroidActions(null)} />,
  };
}

/** Android ⋯ menu: bottom sheet, dismissed by backdrop tap or Cancel. */
function ActionSheet({
  actions,
  onClose,
}: {
  actions: MenuAction[] | null;
  onClose: () => void;
}) {
  const c = useTheme();
  return (
    <Modal visible={actions != null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close menu">
        <Pressable
          style={[styles.sheet, { backgroundColor: c.backgroundElement }]}
          onPress={(e) => e.stopPropagation()}>
          {actions?.map((a) => (
            <Pressable
              key={a.label}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: c.backgroundSelected },
              ]}
              onPress={() => {
                onClose();
                a.run();
              }}>
              <ThemedText style={a.destructive ? styles.destructive : undefined}>
                {a.label}
              </ThemedText>
            </Pressable>
          ))}
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <Pressable
            style={({ pressed }) => [
              styles.row,
              pressed && { backgroundColor: c.backgroundSelected },
            ]}
            onPress={onClose}>
            <ThemedText style={{ color: c.textSecondary }}>Cancel</ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  row: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  destructive: { color: Danger },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.one,
  },
});
