import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  // "Have we hydrated yet" is only knowable from an effect: the effect not
  // running is precisely what static rendering looks like.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setHasHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
