// ── Scheduled Task System ───────────────────────────────────
// ── Cron Parser ─────────────────────────────────────────────
const DAY_NAMES = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
};
function parseField(field, min, max) {
    const values = new Set();
    for (const part of field.split(',')) {
        const stepMatch = part.match(/^(.+)\/(\d+)$/);
        const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
        const range = stepMatch ? stepMatch[1] : part;
        let start, end;
        if (range === '*') {
            start = min;
            end = max;
        }
        else if (range.includes('-')) {
            const [lo, hi] = range.split('-').map((s) => parseSingleValue(s, min, max));
            start = lo;
            end = hi;
        }
        else {
            const v = parseSingleValue(range, min, max);
            start = v;
            end = v;
        }
        if (start < min || end > max || start > end || step < 1) {
            throw new Error(`Invalid cron field: ${field}`);
        }
        for (let i = start; i <= end; i += step)
            values.add(i);
    }
    return values;
}
function parseSingleValue(s, min, max) {
    const lower = s.toLowerCase();
    if (DAY_NAMES[lower] !== undefined)
        return DAY_NAMES[lower];
    const n = parseInt(s, 10);
    if (Number.isNaN(n) || n < min || n > max)
        throw new Error(`Invalid cron value: ${s}`);
    return n;
}
export function parseCron(expr) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5)
        throw new Error(`Invalid cron expression (need 5 fields): ${expr}`);
    return {
        minutes: parseField(parts[0], 0, 59),
        hours: parseField(parts[1], 0, 23),
        daysOfMonth: parseField(parts[2], 1, 31),
        months: parseField(parts[3], 1, 12),
        daysOfWeek: parseField(parts[4], 0, 6),
    };
}
// ── Next Fire Time ──────────────────────────────────────────
const MAX_ITERATIONS = 2 * 366 * 24 * 60; // ~2 years in minutes
export function getNextCronTime(fields, after) {
    const d = new Date(after ?? Date.now());
    // Start from the next minute
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    for (let i = 0; i < MAX_ITERATIONS; i++) {
        if (!fields.months.has(d.getMonth() + 1)) {
            // Skip to first day of next month
            d.setMonth(d.getMonth() + 1, 1);
            d.setHours(0, 0, 0, 0);
            continue;
        }
        if (!fields.daysOfMonth.has(d.getDate()) || !fields.daysOfWeek.has(d.getDay())) {
            // Skip to next day
            d.setDate(d.getDate() + 1);
            d.setHours(0, 0, 0, 0);
            continue;
        }
        if (!fields.hours.has(d.getHours())) {
            // Skip to next hour
            d.setHours(d.getHours() + 1, 0, 0, 0);
            continue;
        }
        if (!fields.minutes.has(d.getMinutes())) {
            d.setMinutes(d.getMinutes() + 1);
            continue;
        }
        return new Date(d);
    }
    throw new Error('No matching cron time found within 2 years');
}
export function getNextCronDelay(expr, after) {
    const fields = parseCron(normalizeSchedule(expr));
    const next = getNextCronTime(fields, after);
    return next.getTime() - (after ?? new Date()).getTime();
}
// ── Human-readable Schedule Normalization ───────────────────
export function normalizeSchedule(schedule) {
    const s = schedule.trim().toLowerCase();
    // "every Nm" → */N * * * *
    const everyMin = s.match(/^every\s+(\d+)m$/);
    if (everyMin)
        return `*/${everyMin[1]} * * * *`;
    // "every Nh" → 0 */N * * *
    const everyHour = s.match(/^every\s+(\d+)h$/);
    if (everyHour)
        return `0 */${everyHour[1]} * * *`;
    // "daily HH:MM" → M H * * *
    const daily = s.match(/^daily\s+(\d{1,2}):(\d{2})$/);
    if (daily)
        return `${parseInt(daily[2], 10)} ${parseInt(daily[1], 10)} * * *`;
    // "weekly DAY HH:MM" → M H * * DOW
    const weekly = s.match(/^weekly\s+(\w+)\s+(\d{1,2}):(\d{2})$/);
    if (weekly) {
        const dow = DAY_NAMES[weekly[1]];
        if (dow === undefined)
            throw new Error(`Unknown day name: ${weekly[1]}`);
        return `${parseInt(weekly[3], 10)} ${parseInt(weekly[2], 10)} * * ${dow}`;
    }
    // Pass through as-is (assumed to be standard cron)
    return schedule.trim();
}
export class Scheduler {
    tasks = new Map();
    addTask(task, handler) {
        // Remove existing task with the same id
        if (this.tasks.has(task.id))
            this.removeTask(task.id);
        const normalizedCron = normalizeSchedule(task.schedule);
        // Validate the cron expression eagerly
        parseCron(normalizedCron);
        const entry = { def: task, handler, timer: null, normalizedCron };
        this.tasks.set(task.id, entry);
        if (task.enabled)
            this.scheduleNext(entry);
    }
    removeTask(taskId) {
        const entry = this.tasks.get(taskId);
        if (!entry)
            return;
        if (entry.timer)
            clearTimeout(entry.timer);
        this.tasks.delete(taskId);
    }
    enableTask(taskId) {
        const entry = this.tasks.get(taskId);
        if (!entry)
            return;
        entry.def.enabled = true;
        if (!entry.timer)
            this.scheduleNext(entry);
    }
    disableTask(taskId) {
        const entry = this.tasks.get(taskId);
        if (!entry)
            return;
        entry.def.enabled = false;
        if (entry.timer) {
            clearTimeout(entry.timer);
            entry.timer = null;
        }
    }
    getNextRun(taskId) {
        const entry = this.tasks.get(taskId);
        if (!entry || !entry.def.enabled)
            return null;
        try {
            const fields = parseCron(entry.normalizedCron);
            return getNextCronTime(fields);
        }
        catch {
            return null;
        }
    }
    stop() {
        for (const entry of this.tasks.values()) {
            if (entry.timer) {
                clearTimeout(entry.timer);
                entry.timer = null;
            }
        }
    }
    scheduleNext(entry) {
        const fields = parseCron(entry.normalizedCron);
        const next = getNextCronTime(fields);
        const delay = Math.max(0, next.getTime() - Date.now());
        const timer = setTimeout(async () => {
            entry.timer = null;
            try {
                await entry.handler(entry.def);
            }
            catch {
                // Handler failure must not prevent next scheduling
            }
            if (entry.def.enabled && this.tasks.has(entry.def.id)) {
                this.scheduleNext(entry);
            }
        }, delay);
        timer.unref();
        entry.timer = timer;
    }
}
//# sourceMappingURL=scheduler.js.map