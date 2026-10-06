import { describe, expect, it } from 'vitest';
import { computeStreak } from './streak';
import { dayLabel, describeStreak, monthName } from './streakText';

describe('describeStreak', () => {
  it('no shifts', () => {
    const t = describeStreak(computeStreak([], '2026-10-06'));
    expect(t).toEqual({ streakLine: 'No streak yet', ptoLine: 'One free day off (PTO) available this week', riskLine: undefined, probationLine: undefined, hiredBadge: undefined });
  });
  it('singular / plural', () => {
    expect(describeStreak(computeStreak(['2026-10-06'], '2026-10-06')).streakLine).toBe('Streak: 1 day');
    expect(describeStreak(computeStreak(['2026-10-05', '2026-10-06'], '2026-10-06')).streakLine).toBe('Streak: 2 days');
  });
  it('PTO used vs available is stated in words', () => {
    expect(describeStreak(computeStreak(['2026-10-05', '2026-10-07'], '2026-10-07')).ptoLine).toBe('Day off (PTO) used this week');
    expect(describeStreak(computeStreak(['2026-10-05', '2026-10-06'], '2026-10-06')).ptoLine).toBe('One free day off (PTO) available this week');
  });
  it('the "keep your streak" nudge only while a live streak is waiting for today', () => {
    expect(describeStreak(computeStreak(['2026-10-06'], '2026-10-07')).riskLine).toBe('Clock in today to keep your streak.');
    expect(describeStreak(computeStreak(['2026-10-07'], '2026-10-07')).riskLine).toBeUndefined();
    expect(describeStreak(computeStreak([], '2026-10-07')).riskLine).toBeUndefined();
  });
  it('probation line while active, Hired badge once complete, never both', () => {
    const active = describeStreak(computeStreak(['2026-10-05', '2026-10-06'], '2026-10-07'));
    expect(active.probationLine).toBe('Probation: 2/5 shifts · 5 days left');
    expect(active.hiredBadge).toBeUndefined();
    const hired = describeStreak(computeStreak(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'], '2026-10-09'));
    expect(hired.hiredBadge).toBe('Hired ✓');
    expect(hired.probationLine).toBeUndefined();
    expect(describeStreak(computeStreak(['2026-10-05', '2026-10-06'], '2026-10-11')).probationLine).toBe('Probation: 2/5 shifts · 1 day left');
  });
});

describe('calendar labels', () => {
  it('month names and cell labels for TalkBack', () => {
    expect(monthName(1)).toBe('January');
    expect(monthName(12)).toBe('December');
    expect(dayLabel('2026-10-06', 0)).toBe('6 October, no shift');
    expect(dayLabel('2026-10-06', 1)).toBe('6 October, 1 shift');
    expect(dayLabel('2026-12-31', 3)).toBe('31 December, 3 shifts');
  });
});
