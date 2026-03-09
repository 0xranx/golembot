import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseCron,
  normalizeSchedule,
  getNextCronTime,
  getNextCronDelay,
  Scheduler,
  type ScheduledTaskDef,
} from '../scheduler.js';

// ── parseCron ───────────────────────────────────────────────

describe('parseCron', () => {
  it('parses wildcard expression', () => {
    const f = parseCron('* * * * *');
    expect(f.minutes.size).toBe(60);
    expect(f.hours.size).toBe(24);
    expect(f.daysOfMonth.size).toBe(31);
    expect(f.months.size).toBe(12);
    expect(f.daysOfWeek.size).toBe(7);
  });

  it('parses specific values', () => {
    const f = parseCron('5 9 15 6 3');
    expect([...f.minutes]).toEqual([5]);
    expect([...f.hours]).toEqual([9]);
    expect([...f.daysOfMonth]).toEqual([15]);
    expect([...f.months]).toEqual([6]);
    expect([...f.daysOfWeek]).toEqual([3]);
  });

  it('parses lists', () => {
    const f = parseCron('0,15,30,45 * * * *');
    expect([...f.minutes].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
  });

  it('parses ranges', () => {
    const f = parseCron('* * * * 1-5');
    expect([...f.daysOfWeek].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses step values', () => {
    const f = parseCron('*/15 * * * *');
    expect([...f.minutes].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
  });

  it('parses range with step', () => {
    const f = parseCron('1-10/3 * * * *');
    expect([...f.minutes].sort((a, b) => a - b)).toEqual([1, 4, 7, 10]);
  });

  it('parses day-of-week names', () => {
    const f = parseCron('0 9 * * mon-fri');
    expect([...f.daysOfWeek].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('throws on invalid field count', () => {
    expect(() => parseCron('* * *')).toThrow('Invalid cron expression');
  });

  it('throws on out-of-range value', () => {
    expect(() => parseCron('60 * * * *')).toThrow();
  });

  it('throws on invalid value', () => {
    expect(() => parseCron('abc * * * *')).toThrow();
  });
});

// ── normalizeSchedule ───────────────────────────────────────

describe('normalizeSchedule', () => {
  it('converts "every 30m"', () => {
    expect(normalizeSchedule('every 30m')).toBe('*/30 * * * *');
  });

  it('converts "every 6h"', () => {
    expect(normalizeSchedule('every 6h')).toBe('0 */6 * * *');
  });

  it('converts "daily 09:00"', () => {
    expect(normalizeSchedule('daily 09:00')).toBe('0 9 * * *');
  });

  it('converts "weekly mon 09:00"', () => {
    expect(normalizeSchedule('weekly mon 09:00')).toBe('0 9 * * 1');
  });

  it('converts "weekly sun 14:30"', () => {
    expect(normalizeSchedule('weekly sun 14:30')).toBe('30 14 * * 0');
  });

  it('passes through standard cron', () => {
    expect(normalizeSchedule('*/15 * * * *')).toBe('*/15 * * * *');
  });

  it('throws on unknown day name', () => {
    expect(() => normalizeSchedule('weekly xyz 09:00')).toThrow('Unknown day name');
  });
});

// ── getNextCronTime ─────────────────────────────────────────

describe('getNextCronTime', () => {
  it('finds next minute for wildcard', () => {
    const after = new Date(2026, 2, 9, 10, 30, 0); // March 9, 2026 10:30:00
    const next = getNextCronTime(parseCron('* * * * *'), after);
    expect(next.getMinutes()).toBe(31);
    expect(next.getHours()).toBe(10);
  });

  it('finds next Monday 09:00 when after is Friday', () => {
    // March 6, 2026 is a Friday
    const after = new Date(2026, 2, 6, 10, 0, 0);
    const fields = parseCron('0 9 * * 1-5');
    const next = getNextCronTime(fields, after);
    // Next weekday 09:00 → Monday March 9
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(9);
  });

  it('finds next occurrence for specific time', () => {
    const after = new Date(2026, 2, 9, 8, 0, 0); // 08:00
    const fields = parseCron('30 14 * * *'); // 14:30 daily
    const next = getNextCronTime(fields, after);
    expect(next.getHours()).toBe(14);
    expect(next.getMinutes()).toBe(30);
    expect(next.getDate()).toBe(9); // Same day
  });

  it('rolls to next day when time has passed', () => {
    const after = new Date(2026, 2, 9, 15, 0, 0); // 15:00
    const fields = parseCron('30 14 * * *'); // 14:30 daily
    const next = getNextCronTime(fields, after);
    expect(next.getHours()).toBe(14);
    expect(next.getMinutes()).toBe(30);
    expect(next.getDate()).toBe(10); // Next day
  });

  it('finds next specific month occurrence', () => {
    const after = new Date(2026, 5, 1, 0, 0, 0); // June 1
    const fields = parseCron('0 0 1 1 *'); // Jan 1st midnight
    const next = getNextCronTime(fields, after);
    expect(next.getMonth()).toBe(0); // January
    expect(next.getFullYear()).toBe(2027);
  });
});

// ── getNextCronDelay ────────────────────────────────────────

describe('getNextCronDelay', () => {
  it('returns positive ms delay', () => {
    const delay = getNextCronDelay('* * * * *');
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(60_000);
  });

  it('works with human-readable schedules', () => {
    const delay = getNextCronDelay('every 30m');
    expect(delay).toBeGreaterThan(0);
  });
});

// ── Scheduler ───────────────────────────────────────────────

describe('Scheduler', () => {
  beforeEach(() => {
    // Set fake timers to a known point: exactly on a minute boundary
    vi.useFakeTimers({ now: new Date(2026, 2, 9, 10, 0, 0, 0) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeTask(overrides: Partial<ScheduledTaskDef> = {}): ScheduledTaskDef {
    return {
      id: 'test-1',
      name: 'Test Task',
      schedule: '*/1 * * * *',
      prompt: 'do something',
      enabled: true,
      ...overrides,
    };
  }

  it('fires handler at next scheduled time', async () => {
    const scheduler = new Scheduler();
    const handler = vi.fn().mockResolvedValue(undefined);

    scheduler.addTask(makeTask(), handler);

    // Advance to the next minute boundary + a bit
    await vi.advanceTimersByTimeAsync(61_000);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'test-1' }));

    scheduler.stop();
  });

  it('chains: fires handler again after first run', async () => {
    const scheduler = new Scheduler();
    const handler = vi.fn().mockResolvedValue(undefined);

    scheduler.addTask(makeTask(), handler);

    // Advance past two firing windows
    await vi.advanceTimersByTimeAsync(121_000);

    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);

    scheduler.stop();
  });

  it('still schedules next after handler throws', async () => {
    const scheduler = new Scheduler();
    const handler = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);

    scheduler.addTask(makeTask(), handler);

    // First fire → throws
    await vi.advanceTimersByTimeAsync(61_000);
    expect(handler).toHaveBeenCalledTimes(1);

    // Second fire → succeeds
    await vi.advanceTimersByTimeAsync(61_000);
    expect(handler).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it('removeTask stops the timer', async () => {
    const scheduler = new Scheduler();
    const handler = vi.fn().mockResolvedValue(undefined);

    scheduler.addTask(makeTask(), handler);
    scheduler.removeTask('test-1');

    await vi.advanceTimersByTimeAsync(120_000);

    expect(handler).not.toHaveBeenCalled();
  });

  it('disableTask stops timer, enableTask re-schedules', async () => {
    const scheduler = new Scheduler();
    const handler = vi.fn().mockResolvedValue(undefined);

    scheduler.addTask(makeTask(), handler);
    scheduler.disableTask('test-1');

    await vi.advanceTimersByTimeAsync(120_000);
    expect(handler).not.toHaveBeenCalled();

    scheduler.enableTask('test-1');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(handler).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('getNextRun returns a future date for enabled tasks', () => {
    const scheduler = new Scheduler();
    const handler = vi.fn().mockResolvedValue(undefined);

    scheduler.addTask(makeTask(), handler);
    const next = scheduler.getNextRun('test-1');
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBeGreaterThan(Date.now());

    scheduler.stop();
  });

  it('getNextRun returns null for disabled tasks', () => {
    const scheduler = new Scheduler();
    const handler = vi.fn().mockResolvedValue(undefined);

    scheduler.addTask(makeTask({ enabled: false }), handler);
    expect(scheduler.getNextRun('test-1')).toBeNull();

    scheduler.stop();
  });

  it('getNextRun returns null for unknown tasks', () => {
    const scheduler = new Scheduler();
    expect(scheduler.getNextRun('nonexistent')).toBeNull();
    scheduler.stop();
  });

  it('stop clears all timers', async () => {
    const scheduler = new Scheduler();
    const handler = vi.fn().mockResolvedValue(undefined);

    scheduler.addTask(makeTask({ id: 'a' }), handler);
    scheduler.addTask(makeTask({ id: 'b' }), handler);

    scheduler.stop();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(handler).not.toHaveBeenCalled();
  });

  it('addTask with disabled flag does not schedule', async () => {
    const scheduler = new Scheduler();
    const handler = vi.fn().mockResolvedValue(undefined);

    scheduler.addTask(makeTask({ enabled: false }), handler);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(handler).not.toHaveBeenCalled();

    scheduler.stop();
  });
});
