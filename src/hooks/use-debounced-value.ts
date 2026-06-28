import { useEffect, useState } from 'react';

/**
 * Returns `value` after it has stopped changing for `delay` ms. Useful for
 * type-ahead so we don't fire a request on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
