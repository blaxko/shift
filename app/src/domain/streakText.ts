// F9 wording (kept out of the screens so it is unit-tested). NFR-A5: status is always words, never colour alone.
import type { StreakResult } from './streak';

export interface StreakText {
  streakLine: string;
  ptoLine: string;
  /** Present only while a live streak is waiting for today's shift. */
  riskLine?: string;
  probationLine?: string;
  /** Present once the probation week is completed (FR-9.3, client-side badge). */
  hiredBadge?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function describeStreak(r: StreakResult): StreakText {
  const p = r.probation;
  return {
    streakLine: r.streak === 0 ? 'No streak yet' : `Streak: ${plural(r.streak, 'day')}`,
    ptoLine: r.ptoUsedThisWeek ? 'Day off (PTO) used this week' : 'One free day off (PTO) available this week',
    riskLine: r.atRisk ? 'Clock in today to keep your streak.' : undefined,
    probationLine: p && p.status === 'active' ? `Probation: ${p.shifts}/${p.goal} shifts · ${plural(p.daysLeft, 'day')} left` : undefined,
    hiredBadge: p && p.status === 'hired' ? 'Hired ✓' : undefined,
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (month1: number) => MONTHS[month1 - 1]!;

/** Screen-reader label for one calendar cell: "6 October, 2 shifts" / "6 October, no shift". */
export function dayLabel(date: string, count: number): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${monthName(m)}, ${count === 0 ? 'no shift' : plural(count, 'shift')}`;
}
