import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getUnreadCount, subscribeToNotifications } from '@/lib/notifications';
import { emitTabReset } from '@/lib/tab-reset';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  // Unread personal notifications now badge the Feed tab (their new home).
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { data: unread = 0 } = useQuery({
    queryKey: ['notifUnread'],
    queryFn: getUnreadCount,
    enabled: !!session,
  });
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    return subscribeToNotifications(uid, () => {
      queryClient.invalidateQueries({ queryKey: ['notifUnread'] });
    });
  }, [session?.user.id, queryClient]);

  return (
    <NativeTabs
      backgroundColor={colors.background}
      tintColor={colors.tint}
      iconColor={colors.textSecondary}
      indicatorColor={colors.backgroundElement}>
      <NativeTabs.Trigger name="feed">
        <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="rectangle.stack.fill" drawable="ic_menu_agenda" />
        {unread > 0 && (
          <NativeTabs.Trigger.Badge>{String(unread)}</NativeTabs.Trigger.Badge>
        )}
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="(library)"
        listeners={{ tabPress: () => emitTabReset('library') }}>
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="explore"
        listeners={{ tabPress: () => emitTabReset('explore') }}>
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" drawable="ic_menu_myplaces" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
