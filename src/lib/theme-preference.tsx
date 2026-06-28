import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState } from 'react';
import { Appearance } from 'react-native';

/**
 * User-chosen theme preference, persisted across launches.
 *
 * 'system' defers to the OS (the default). 'light'/'dark' pin the app via
 * RN's Appearance.setColorScheme(), which rewrites what useColorScheme()
 * returns everywhere — so useTheme() and the nav chrome inherit it untouched.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'WATCHBUDDY_THEME_PREF';
const CYCLE: ThemePreference[] = ['light', 'dark', 'system'];

function apply(pref: ThemePreference) {
  // 'unspecified' hands control back to the OS (RN 0.85 has no null overload).
  Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref);
}

type ThemePreferenceValue = {
  pref: ThemePreference;
  loaded: boolean;
  cycle: () => void;
};

const ThemePreferenceContext = createContext<ThemePreferenceValue | undefined>(
  undefined,
);

export function ThemePreferenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pref, setPref] = useState<ThemePreference>('system');
  const [loaded, setLoaded] = useState(false);

  // Load the saved preference once and apply it BEFORE flipping `loaded`, so
  // the gated first paint already reflects the right scheme (no flash).
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        const value: ThemePreference =
          stored === 'light' || stored === 'dark' || stored === 'system'
            ? stored
            : 'system';
        apply(value);
        setPref(value);
      })
      .finally(() => setLoaded(true));
  }, []);

  // Re-apply and persist on later changes (e.g. the Profile toggle). Skipped
  // until loaded so it doesn't clobber the initial load above.
  useEffect(() => {
    if (!loaded) return;
    apply(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref);
  }, [pref, loaded]);

  function cycle() {
    setPref((current) => CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]);
  }

  return (
    <ThemePreferenceContext.Provider value={{ pref, loaded, cycle }}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference() {
  const ctx = useContext(ThemePreferenceContext);
  if (!ctx) {
    throw new Error(
      'useThemePreference must be used within a ThemePreferenceProvider',
    );
  }
  return ctx;
}
