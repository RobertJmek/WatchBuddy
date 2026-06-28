import type { DiaryRange } from '@/lib/watches';

export type DiaryPeriod = 'all' | 'week' | 'month' | 'year' | 'custom';

export const DIARY_PERIODS: { value: DiaryPeriod; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'custom', label: 'Custom' },
];

function startOfWeek(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Monday-based week: shift Sunday (0) back to the previous Monday.
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

/**
 * Resolve a preset period to a query range. 'custom' is handled by the caller
 * (it carries its own from/to). 'all' returns no bounds + the default cap.
 */
export function rangeForPeriod(period: DiaryPeriod, now = new Date()): DiaryRange {
  // Bounded periods lift the row cap (null) so a busy span isn't truncated.
  switch (period) {
    case 'week':
      return { from: startOfWeek(now).toISOString(), limit: null };
    case 'month':
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        limit: null,
      };
    case 'year':
      return { from: new Date(now.getFullYear(), 0, 1).toISOString(), limit: null };
    case 'all':
    case 'custom':
    default:
      return {};
  }
}
