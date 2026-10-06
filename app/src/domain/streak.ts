// F9 — streak, PTO, probation, timesheet grid. PRD FR-9.1-9.4, AC-9.1, AC-9.2, E-15, E-16. PURE: derived only from the on-chain memo ledger,
// so a reinstall rebuilds exactly the same numbers (AC-9.2). Dates are 'YYYY-MM-DD' strings handled as UTC epoch-day numbers: no device
// time zone ever enters the arithmetic (the memo carries the user's local date; the device only supplies "today").

const DAY_MS = 86_400_000;

export const toDayNum = (ymd: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new RangeError(`bad date ${ymd}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
};
export const fromDayNum = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Monday = 1 ... Sunday = 7. 1970-01-01 (day 0) was a Thursday. */
const isoWeekday = (n: number) => ((((n + 3) % 7) + 7) % 7) + 1;

/** ISO 8601 week key "YYYY-Www" (weeks run Monday..Sunday; the week belongs to the year of its Thursday). */
export function isoWeekKey(n: number): string {
  const thursday = n - isoWeekday(n) + 4;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1) / DAY_MS;
  const week = Math.floor((thursday - jan1) / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * FR-9.4 / E-15 / E-16. The memo's `localDate` is what counts (a clock-in at 23:59 local belongs to that day), unless it is more than 36 h
 * away from the transaction's blockTime, in which case the blockTime's own date (in the memo's time zone) is used instead.
 */
export function effectiveLocalDate(localDate: string, tzOffsetMin: number, blockTimeUnix: number): string {
  let claimedNoonUtcMs: number;
  try {
    // local noon of the claimed date, expressed as a real instant
    claimedNoonUtcMs = toDayNum(localDate) * DAY_MS + 12 * 3_600_000 - tzOffsetMin * 60_000;
  } catch {
    return fromDayNum(Math.floor((blockTimeUnix * 1000 + tzOffsetMin * 60_000) / DAY_MS));
  }
  const diffH = Math.abs(claimedNoonUtcMs - blockTimeUnix * 1000) / 3_600_000;
  if (diffH <= 36) return localDate;
  return fromDayNum(Math.floor((blockTimeUnix * 1000 + tzOffsetMin * 60_000) / DAY_MS));
}

export const PROBATION_GOAL = 5;
const PROBATION_DAYS = 7;

export interface Probation {
  /** Shifts started within the probation window. */
  shifts: number;
  goal: typeof PROBATION_GOAL;
  /** 'hired' is permanent once reached (derived from the ledger, so it survives a reinstall). */
  status: 'active' | 'hired';
  /** Last day of the 7-day window (first shift day + 6). */
  windowEnd: string;
  /** Days left in the window including today (0 once it has passed). Only meaningful while active. */
  daysLeft: number;
}

export interface StreakResult {
  /** Days with a shift in the unbroken run (PTO days bridge a gap but are not counted). */
  streak: number;
  /** The PTO for today's ISO week is already spent. */
  ptoUsedThisWeek: boolean;
  /** Days PTO has covered so far (oldest first). */
  ptoDays: string[];
  workedToday: boolean;
  /** A live streak that today's shift would extend: shown as "Clock in today to keep it". */
  atRisk: boolean;
  lastShiftDay: string | null;
  probation: Probation | undefined;
}

/**
 * `days` = the effective local date of EVERY shift (one entry per clock-in; several on one day are fine and each counts as a shift for
 * probation but only once for the streak). `todayLocal` = today's date on the device.
 *
 * Streak rules (PRD FR-9.2, fixed deterministically):
 *  - scan chronologically from the first shift day up to today (if there is a shift today) or yesterday (today's miss is not a miss yet);
 *  - a worked day extends the run; a missed day is covered by PTO if its ISO week's one free PTO is unused (so, in a week with two missed
 *    days, the OLDEST is the one covered), otherwise the run is broken back to 0;
 *  - days dated in the future (clock tampering) are ignored.
 */
export function computeStreak(days: string[], todayLocal: string): StreakResult {
  const today = toDayNum(todayLocal);
  const all = days.map(toDayNum).filter((d) => d <= today);
  const worked = new Set(all);
  if (worked.size === 0) return { streak: 0, ptoUsedThisWeek: false, ptoDays: [], workedToday: false, atRisk: false, lastShiftDay: null, probation: undefined };

  const first = Math.min(...worked);
  const last = Math.max(...worked);
  const workedToday = worked.has(today);
  const end = workedToday ? today : today - 1;

  let run = 0;
  const ptoWeeks = new Set<string>();
  const ptoDays: number[] = [];
  for (let d = first; d <= end; d++) {
    if (worked.has(d)) run++;
    else {
      const wk = isoWeekKey(d);
      if (!ptoWeeks.has(wk)) {
        ptoWeeks.add(wk);
        ptoDays.push(d);
      } else run = 0; // second missed day in the same ISO week: broken
    }
  }

  return {
    streak: run,
    ptoUsedThisWeek: ptoWeeks.has(isoWeekKey(today)),
    ptoDays: ptoDays.map(fromDayNum),
    workedToday,
    atRisk: run > 0 && !workedToday,
    lastShiftDay: fromDayNum(last),
    probation: computeProbation(all, today),
  };
}

/** FR-9.3. `allDays` keeps duplicates: probation counts shifts, not days. */
function computeProbation(allDays: number[], today: number): Probation | undefined {
  if (allDays.length === 0) return undefined;
  const first = Math.min(...allDays);
  const windowEnd = first + PROBATION_DAYS - 1;
  const shifts = allDays.filter((d) => d <= windowEnd).length;
  if (shifts >= PROBATION_GOAL) return { shifts, goal: PROBATION_GOAL, status: 'hired', windowEnd: fromDayNum(windowEnd), daysLeft: 0 };
  if (today > windowEnd) return undefined; // the week passed without enough shifts: nothing to show
  return { shifts, goal: PROBATION_GOAL, status: 'active', windowEnd: fromDayNum(windowEnd), daysLeft: windowEnd - today + 1 };
}

export interface GridCell {
  day: number;
  date: string;
  marked: boolean;
  /** number of shifts that day (0 if none) */
  count: number;
}

/** Month calendar, Monday-first. null = blank cell before day 1 / after the last day. */
export function monthGrid(year: number, month1: number, daysWithShifts: string[]): (GridCell | null)[][] {
  const counts = new Map<string, number>();
  for (const d of daysWithShifts) counts.set(d, (counts.get(d) ?? 0) + 1);
  const firstNum = Date.UTC(year, month1 - 1, 1) / DAY_MS;
  const lastDay = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  const lead = isoWeekday(firstNum) - 1;
  const cells: (GridCell | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= lastDay; day++) {
    const date = fromDayNum(firstNum + day - 1);
    const count = counts.get(date) ?? 0;
    cells.push({ day, date, marked: count > 0, count });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (GridCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Device-local "today" as YYYY-MM-DD (the only place the device time zone is used). */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
