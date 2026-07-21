import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import AppTabs from '@/components/app-tabs';
import { useAuth } from '@/lib/auth-context';
import { hasSeenOnboarding } from '@/lib/onboarding';
import { getMyProfile } from '@/lib/profile';

export default function AppLayout() {
  const router = useRouter();
  const { session } = useAuth();
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: getMyProfile });
  // One redirect per mount — avoids a second push if the profile query refetches.
  const redirected = useRef(false);

  // First-run gate: a freshly signed-up user has a profile row but no username
  // (the new-user trigger leaves it null). Suggest they set one + an avatar so
  // friends can find them. Skippable and remembered — see src/lib/onboarding.ts.
  useEffect(() => {
    if (redirected.current || !session || !profile || profile.username) return;
    let cancelled = false;
    hasSeenOnboarding(session.user.id)
      .then((seen) => {
        if (cancelled || seen || redirected.current) return;
        redirected.current = true;
        router.replace('/onboarding');
      })
      // A local-storage read failure shouldn't crash the app or spam the console;
      // worst case the gate simply doesn't fire this mount.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, profile, router]);

  return <AppTabs />;
}
