import { describe, expect, it } from 'vitest';
import { PROBATION_GOAL, computeStreak, effectiveLocalDate, fromDayNum, isoWeekKey, localToday, monthGrid, toDayNum } from './streak';

// Calendar reference (verified): 2026-10-01 Thu, 10-02 Fri, 10-03 Sat, 10-04 Sun, 10-05 Mon, 10-06 Tue, 10-07 Wed, 10-08 Thu, 10-09 Fri, 10-10 Sat, 10-11 Sun, 10-12 Mon.
const MON = '2026-10-05';
const TUE = '2026-10-06';
const WED = '2026-10-07';
const THU = '2026-10-08';

describe('date helpers', () => {
  it('round-trip and ISO weekday maths', () => {
    expect(fromDayNum(toDayNum('2026-10-06'))).toBe('2026-10-06');
    expect(fromDayNum(toDayNum('2028-02-28') + 1)).toBe('2028-02-29'); // leap day
    expect(fromDayNum(toDayNum('2028-02-29') + 1)).toBe('2028-03-01');
    expect(fromDayNum(toDayNum('2026-12-31') + 1)).toBe('2027-01-01');
    expect(() => toDayNum('nope')).toThrow();
  });
  it('ISO week keys: Monday..Sunday, week 53 of 2026, and the year-boundary weeks', () => {
    expect(isoWeekKey(toDayNum('2026-10-05'))).toBe(isoWeekKey(toDayNum('2026-10-11'))); // Mon..Sun same week
    expect(isoWeekKey(toDayNum('2026-10-11'))).not.toBe(isoWeekKey(toDayNum('2026-10-12')));
    expect(isoWeekKey(toDayNum('2026-01-01'))).toBe('2026-W01'); // Thursday 1 Jan: week 1
    expect(isoWeekKey(toDayNum('2025-12-29'))).toBe('2026-W01'); // Monday before it belongs to 2026-W01
    expect(isoWeekKey(toDayNum('2027-01-01'))).toBe('2026-W53'); // Friday 1 Jan 2027 still in 2026's last week
    expect(isoWeekKey(toDayNum('2027-01-04'))).toBe('2027-W01');
  });
});

describe('computeStreak (AC-9.1)', () => {
  it('no shifts', () => {
    expect(computeStreak([], TUE)).toEqual({ streak: 0, ptoUsedThisWeek: false, ptoDays: [], workedToday: false, atRisk: false, lastShiftDay: null, probation: undefined });
  });
  it('a single day: today', () => {
    const r = computeStreak([TUE], TUE);
    expect(r).toMatchObject({ streak: 1, workedToday: true, atRisk: false, lastShiftDay: TUE, ptoDays: [] });
  });
  it('a single day: yesterday keeps the streak alive, and today\'s shift is what extends it (atRisk)', () => {
    expect(computeStreak([TUE], WED)).toMatchObject({ streak: 1, workedToday: false, atRisk: true });
  });
  it('consecutive days', () => {
    expect(computeStreak([MON, TUE, WED, THU], THU).streak).toBe(4);
    expect(computeStreak([MON, TUE, WED, THU], THU).ptoDays).toEqual([]);
  });
  it('one gap covered by PTO: the missed day bridges but is not counted as a worked day', () => {
    const r = computeStreak([MON, WED], WED);
    expect(r.streak).toBe(2);
    expect(r.ptoDays).toEqual([TUE]);
    expect(r.ptoUsedThisWeek).toBe(true);
  });
  it('an unspent PTO covers "yesterday" while today is still open: the streak survives a day off', () => {
    const r = computeStreak([MON], WED); // Tuesday missed, Wednesday not over
    expect(r).toMatchObject({ streak: 1, atRisk: true, ptoUsedThisWeek: true, ptoDays: [TUE] });
  });
  it('two missed days in ONE ISO week break the streak (the oldest is the one PTO covers)', () => {
    expect(computeStreak([MON], THU)).toMatchObject({ streak: 0, ptoDays: [TUE] }); // Tue covered, Wed breaks
    const r = computeStreak([MON, THU], THU); // Mon, [Tue PTO], Wed broke, Thu starts again
    expect(r.streak).toBe(1);
    expect(r.ptoDays).toEqual([TUE]);
  });
  it('PTO renews every ISO week: a gap in week 40 and another in week 41 are both covered', () => {
    // Fri 10-02, [Sat 10-03 PTO wk40], Sun 10-04, Mon 10-05, [Tue 10-06 PTO wk41], Wed 10-07
    const r = computeStreak(['2026-10-02', '2026-10-04', MON, WED], WED);
    expect(r.streak).toBe(4);
    expect(r.ptoDays).toEqual(['2026-10-03', TUE]);
  });
  it('the Sunday/Monday boundary: a missed Sunday and a missed Monday are in DIFFERENT weeks, so both are covered', () => {
    const r = computeStreak(['2026-10-03', TUE], TUE); // Sat, [Sun PTO wk40], [Mon PTO wk41], Tue
    expect(r.streak).toBe(2);
    expect(r.ptoDays).toEqual(['2026-10-04', MON]);
  });
  it('PTO already spent earlier in the SAME week is not available again (Mon gap covered in the past, a later gap breaks)', () => {
    // shifts Sun 10-04, [Mon 10-05 PTO], Tue 10-06, [Wed 10-07 ?], today Thu 10-08 no shift => Wed 2nd miss in week 41 -> broken
    expect(computeStreak(['2026-10-04', TUE], THU).streak).toBe(0);
  });
  it('several shifts on one day count once for the streak', () => {
    expect(computeStreak([MON, MON, MON, TUE], TUE).streak).toBe(2);
  });
  it('ignores future-dated shifts (clock tampering, E-15)', () => {
    expect(computeStreak([TUE, '2026-12-31'], TUE).streak).toBe(1);
    expect(computeStreak(['2026-12-31'], TUE).lastShiftDay).toBeNull();
  });
  it('crosses month, year and leap-day boundaries', () => {
    expect(computeStreak(['2028-02-28', '2028-02-29', '2028-03-01'], '2028-03-01').streak).toBe(3);
    expect(computeStreak(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'], '2027-01-02').streak).toBe(4);
  });
  it('a long streak with exactly one PTO per week stays alive; a second miss in a week ends it', () => {
    // Mon..Sun of week 41 worked except Wed (PTO) -> 6 worked; then Thu of week 42 missed (PTO wk42)
    const days = ['2026-10-05', '2026-10-06', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-14'];
    expect(computeStreak(days, '2026-10-14').streak).toBe(8); // [Tue 10-13 PTO wk42] covered
    expect(computeStreak(days, '2026-10-15').streak).toBe(8); // Thu 10-15 not over
    expect(computeStreak(days, '2026-10-16').streak).toBe(0); // Thu AND Fri missed in wk42: Thu 10-15 is 2nd miss -> broken
  });
});

describe('THE TIMEZONE-BOUNDARY CASE (E-15, E-16, FR-9.4)', () => {
  const utc = (iso: string) => Math.floor(Date.parse(iso) / 1000);

  it('E-16: a clock-in at 23:59 local counts for THAT day (the memo date), not the UTC date', () => {
    // UTC+1: 23:59 local on 4 Oct = 22:59Z. Then 00:30 local on 5 Oct = 23:30Z on the SAME UTC day.
    const a = effectiveLocalDate('2026-10-04', 60, utc('2026-10-04T22:59:00Z'));
    const b = effectiveLocalDate('2026-10-05', 60, utc('2026-10-04T23:30:00Z'));
    expect([a, b]).toEqual(['2026-10-04', '2026-10-05']);
    expect(computeStreak([a, b], '2026-10-05').streak).toBe(2);
    // A naive UTC reading would have collapsed them into one day:
    expect(computeStreak(['2026-10-04', '2026-10-04'], '2026-10-04').streak).toBe(1);
  });
  it('west of UTC: 22:00 local on 3 Oct in UTC-5 is 03:00Z on 4 Oct and still belongs to the 3rd', () => {
    expect(effectiveLocalDate('2026-10-03', -300, utc('2026-10-04T03:00:00Z'))).toBe('2026-10-03');
  });
  it('FR-9.4: a localDate more than 36 h from the blockTime is replaced by the blockTime date', () => {
    expect(effectiveLocalDate('2026-09-01', 0, utc('2026-10-04T12:00:00Z'))).toBe('2026-10-04'); // far in the past
    expect(effectiveLocalDate('2026-12-01', 0, utc('2026-10-04T12:00:00Z'))).toBe('2026-10-04'); // far in the future
    expect(effectiveLocalDate('garbage', 0, utc('2026-10-04T12:00:00Z'))).toBe('2026-10-04');
  });
  it('FR-9.4 boundary: exactly 36 h is accepted, one second more is rejected', () => {
    // claimed 2026-10-04 local noon (tz 0) = 2026-10-04T12:00Z
    expect(effectiveLocalDate('2026-10-04', 0, utc('2026-10-06T00:00:00Z'))).toBe('2026-10-04'); // +36 h exactly
    expect(effectiveLocalDate('2026-10-04', 0, utc('2026-10-06T00:00:01Z'))).toBe('2026-10-06'); // +36 h 1 s
    expect(effectiveLocalDate('2026-10-04', 0, utc('2026-10-03T00:00:00Z'))).toBe('2026-10-04'); // -36 h exactly (local noon 10-04 12:00Z minus 36 h)
    expect(effectiveLocalDate('2026-10-04', 0, utc('2026-10-02T23:59:59Z'))).toBe('2026-10-02'); // -36 h 1 s -> blockTime's own date
  });
  it('a user who changes time zone: both entries stay on their own memo dates when plausible', () => {
    const flight = [effectiveLocalDate('2026-10-04', 60, utc('2026-10-04T20:00:00Z')), effectiveLocalDate('2026-10-05', -300, utc('2026-10-05T15:00:00Z'))];
    expect(flight).toEqual(['2026-10-04', '2026-10-05']);
  });
});

describe('probation week (FR-9.3)', () => {
  it('no shifts: nothing', () => {
    expect(computeStreak([], MON).probation).toBeUndefined();
  });
  it('active: counts shifts in the 7-day window and the days left (inclusive of today)', () => {
    const r = computeStreak([MON, TUE], WED).probation!;
    expect(r).toEqual({ shifts: 2, goal: 5, status: 'active', windowEnd: '2026-10-11', daysLeft: 5 });
  });
  it('hired at 5 shifts inside the window; stays hired after the window has passed (derived from the ledger)', () => {
    const days = [MON, TUE, WED, THU, '2026-10-09'];
    expect(computeStreak(days, '2026-10-09').probation).toMatchObject({ status: 'hired', shifts: 5 });
    expect(computeStreak(days, '2027-03-01').probation).toMatchObject({ status: 'hired' });
  });
  it('probation counts SHIFTS, so several in one day count each', () => {
    expect(computeStreak([MON, MON, MON, MON, MON], MON).probation).toMatchObject({ status: 'hired', shifts: 5 });
  });
  it('shifts after the window do not count toward hiring', () => {
    const r = computeStreak([MON, TUE, WED, THU, '2026-10-12'], '2026-10-12').probation; // 4 in window, 5th is on day 8
    expect(r).toBeUndefined(); // window passed, not hired: nothing to show
  });
  it('window passed with too few shifts: nothing shown (no failure banner)', () => {
    expect(computeStreak([MON, TUE], '2026-10-20').probation).toBeUndefined();
  });
  it('the window starts at the FIRST shift day, not at today or at the earliest of a later cluster', () => {
    const r = computeStreak(['2026-10-01', '2026-10-06'], '2026-10-06').probation!; // first Thu 10-01 -> window ends Wed 10-07
    expect(r.windowEnd).toBe('2026-10-07');
    expect(r.shifts).toBe(2);
  });
  it('goal constant', () => {
    expect(PROBATION_GOAL).toBe(5);
  });
});

describe('AC-9.2: the numbers are a pure function of the ledger', () => {
  it('same memo-derived days in any order => same result (a reinstall rebuilds the same streak)', () => {
    const days = [WED, MON, TUE, MON, '2026-10-02'];
    expect(computeStreak(days, WED)).toEqual(computeStreak([...days].reverse(), WED));
  });
});

describe('monthGrid (FR-9.1)', () => {
  it('October 2026 starts on a Thursday: 3 blanks, 31 days, padded to 5 full weeks, Monday-first', () => {
    const g = monthGrid(2026, 10, []);
    expect(g).toHaveLength(5);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[0]!.slice(0, 3)).toEqual([null, null, null]);
    expect(g[0]![3]).toMatchObject({ day: 1, date: '2026-10-01' });
    expect(g[4]![5]).toMatchObject({ day: 31 });
    expect(g[4]![6]).toBeNull();
    expect(g.flat().filter(Boolean)).toHaveLength(31);
  });
  it('marks a day if ANY shift has that date, with the count', () => {
    const g = monthGrid(2026, 10, [MON, MON, '2026-10-20']).flat().filter((c): c is NonNullable<typeof c> => !!c);
    expect(g.find((c) => c.date === MON)).toMatchObject({ marked: true, count: 2 });
    expect(g.find((c) => c.date === '2026-10-20')).toMatchObject({ marked: true, count: 1 });
    expect(g.filter((c) => c.marked)).toHaveLength(2);
    expect(g.find((c) => c.date === TUE)).toMatchObject({ marked: false, count: 0 });
  });
  it('ignores shifts from other months', () => {
    expect(monthGrid(2026, 10, ['2026-09-30', '2026-11-01']).flat().some((c) => c?.marked)).toBe(false);
  });
  it('a 28-day month that starts on Monday is exactly 4 weeks (Feb 2027); a leap February has 29 days', () => {
    expect(monthGrid(2027, 2, [])).toHaveLength(4);
    expect(monthGrid(2028, 2, []).flat().filter(Boolean)).toHaveLength(29);
  });
  it('a month that starts on Sunday needs 6 leading blanks', () => {
    expect(monthGrid(2026, 2, [])[0]!.filter((c) => c === null)).toHaveLength(6); // 1 Feb 2026 is a Sunday
  });
});

describe('localToday', () => {
  it('formats the device-local date with zero padding', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localToday(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });
});
