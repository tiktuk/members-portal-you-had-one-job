/**
 * Turns the portal's calendar bookings into the resource statistics model.
 *
 * Loaded by the content script and the unit tests, so it must stay
 * dependency-free and must not touch `chrome` or `document`. Timestamps are
 * epoch milliseconds in the browser's timezone, matching
 * `lib/overview.js::parseTimestamp`.
 */
(() => {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;

  /** Periods end today; the first two are counts, the last is calendar months. */
  const PERIODS = [
    { id: "4w", label: "4 weeks", days: 28 },
    { id: "3m", label: "3 months", months: 3 },
    { id: "12m", label: "12 months", months: 12 },
  ];

  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const LENGTH_BUCKETS = [
    { label: "Under 1 h", below: 1 },
    { label: "1–2 h", below: 2 },
    { label: "2–4 h", below: 4 },
    { label: "4–8 h", below: 8 },
    { label: "8 h+", below: Infinity },
  ];

  function pad(value, size = 2) {
    return String(value).padStart(size, "0");
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function dayKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }

  function monthStart(key) {
    const [year, month] = String(key).split("-").map(Number);
    return new Date(year, month - 1, 1);
  }

  function nextMonthStart(key) {
    const start = monthStart(key);
    return new Date(start.getFullYear(), start.getMonth() + 1, 1);
  }

  function monthLabel(key) {
    return new Intl.DateTimeFormat("en-GB", { month: "short" }).format(monthStart(key));
  }

  /** Same day `months` earlier, clamped to the target month's last day. */
  function monthsAgo(now, months) {
    const day = now.getDate();
    const target = new Date(now.getFullYear(), now.getMonth() - months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, lastDay));
    return startOfDay(target);
  }

  function periodFor(id, now = new Date()) {
    const period = PERIODS.find((entry) => entry.id === id) || PERIODS[PERIODS.length - 1];
    const end = new Date(now.getTime());
    const start = period.months
      ? monthsAgo(end, period.months)
      : startOfDay(new Date(end.getFullYear(), end.getMonth(), end.getDate() - (period.days - 1)));
    return { ...period, start, end };
  }

  function periodLabel(id) {
    const period = PERIODS.find((entry) => entry.id === id) || PERIODS[PERIODS.length - 1];
    return period.label;
  }

  /** Every calendar month the period touches, inclusive. */
  function monthKeys(start, end) {
    const keys = [];
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= last) {
      keys.push(monthKey(cursor));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return keys;
  }

  /**
   * `parseTimestamp` is `lib/overview.js::parseTimestamp` (or a test stub).
   * Records keep only what the aggregates need; member names are not kept.
   */
  function normalizeRecords(payload, parseTimestamp) {
    const parse = typeof parseTimestamp === "function" ? parseTimestamp : defaultParse;
    const seen = new Set();
    const records = [];

    for (const raw of Array.isArray(payload) ? payload : []) {
      if (!raw || raw.resourceId == null || raw.event === true) continue;
      const resourceId = String(raw.resourceId);
      if (!resourceId || resourceId === "0") continue;

      const start = parse(raw.start);
      const end = parse(raw.end);
      if (!start || !end || end.stamp <= start.stamp) continue;

      const id = String(raw.id ?? `${resourceId}-${start.stamp}`);
      if (seen.has(id)) continue;
      seen.add(id);
      records.push({ id, resourceId, start: start.stamp, end: end.stamp });
    }

    return records;
  }

  function defaultParse(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : { stamp: date.getTime() };
  }

  function weekdayIndex(date) {
    return (date.getDay() + 6) % 7;
  }

  function bandForRate(rate, bands = [0.5, 1.5, 3]) {
    if (!(rate > 0)) return 0;
    if (rate <= bands[0]) return 1;
    if (rate <= bands[1]) return 2;
    if (rate <= bands[2]) return 3;
    return 4;
  }

  /**
   * Narrows a resource list to a menu scope. `scope.type` matches the type
   * slug and `scope.group` the raw GroupName, so a group-scoped screen uses
   * the same exact string the portal's filter does.
   */
  function filterResources(resources, scope) {
    const list = Array.isArray(resources) ? resources : [];
    if (!scope || (!scope.type && !scope.group)) return list;
    return list.filter((resource) => {
      if (!resource) return false;
      if (scope.type && resource.type !== scope.type) return false;
      if (scope.group && resource.group !== scope.group) return false;
      return true;
    });
  }

  /**
   * Builds the whole statistics model for a period. Bookings are clipped to
   * the period, split across local days and hours, and attributed only to
   * resources in `resources` (the published list).
   */
  function aggregate(records, resources, period, options = {}) {
    const bands = Array.isArray(options.bands) && options.bands.length === 3
      ? options.bands
      : [0.5, 1.5, 3];

    const start = period.start.getTime();
    const end = period.end.getTime();
    const periodDays = Math.max(1, Math.ceil((end - startOfDay(period.start).getTime()) / DAY_MS));

    const byId = new Map();
    for (const resource of resources || []) {
      const id = resource && resource.id != null ? String(resource.id) : "";
      if (!id) continue;
      byId.set(id, {
        id,
        name: String(resource.name || ""),
        group: String(resource.group || ""),
        type: String(resource.type || ""),
        bookings: 0,
        hours: 0,
        activeDays: new Set(),
      });
    }

    const days = new Map();
    const weekdayHours = new Array(7).fill(0);
    const weekdayCounts = new Array(7).fill(0);
    const hourHours = new Array(24).fill(0);
    const hourCounts = new Array(24).fill(0);
    const lengths = LENGTH_BUCKETS.map((bucket) => ({ label: bucket.label, count: 0 }));
    const seen = new Set();
    let bookings = 0;
    let hours = 0;

    for (const record of Array.isArray(records) ? records : []) {
      if (!record) continue;
      const id = record.id != null ? String(record.id) : `${record.resourceId}-${record.start}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const resource = byId.get(String(record.resourceId));
      if (!resource) continue;

      const recordStart = Number(record.start);
      const recordEnd = Number(record.end);
      if (!Number.isFinite(recordStart) || !Number.isFinite(recordEnd)) continue;

      const from = Math.max(recordStart, start);
      const to = Math.min(recordEnd, end);
      if (to <= from) continue;

      bookings += 1;
      const duration = (to - from) / HOUR_MS;
      hours += duration;
      resource.bookings += 1;
      resource.hours += duration;

      const fullDuration = (recordEnd - recordStart) / HOUR_MS;
      for (let index = 0; index < LENGTH_BUCKETS.length; index += 1) {
        if (fullDuration < LENGTH_BUCKETS[index].below) {
          lengths[index].count += 1;
          break;
        }
      }

      let day = startOfDay(new Date(from));
      while (day.getTime() < to) {
        const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
        const dayFrom = Math.max(day.getTime(), from);
        const dayTo = Math.min(next.getTime(), to);
        if (dayTo > dayFrom) {
          const key = dayKey(day);
          const entry = days.get(key) || { key, count: 0, hours: 0 };
          entry.count += 1;
          entry.hours += (dayTo - dayFrom) / HOUR_MS;
          days.set(key, entry);
          resource.activeDays.add(key);

          const weekday = weekdayIndex(day);
          weekdayHours[weekday] += (dayTo - dayFrom) / HOUR_MS;
          weekdayCounts[weekday] += 1;
        }
        day = next;
      }

      let hour = new Date(from);
      hour.setMinutes(0, 0, 0);
      while (hour.getTime() < to) {
        const next = new Date(
          hour.getFullYear(),
          hour.getMonth(),
          hour.getDate(),
          hour.getHours() + 1,
        );
        const hourFrom = Math.max(hour.getTime(), from);
        const hourTo = Math.min(next.getTime(), to);
        if (hourTo > hourFrom) {
          const index = hour.getHours();
          hourHours[index] += (hourTo - hourFrom) / HOUR_MS;
          hourCounts[index] += 1;
        }
        hour = next;
      }
    }

    const enriched = [];
    for (const resource of byId.values()) {
      const rate = resource.hours / periodDays;
      enriched.push({
        id: resource.id,
        name: resource.name,
        group: resource.group,
        type: resource.type,
        bookings: resource.bookings,
        hours: resource.hours,
        activeDays: resource.activeDays.size,
        rate,
        share: hours > 0 ? resource.hours / hours : 0,
        band: bandForRate(rate, bands),
      });
    }

    let busiestDay = null;
    for (const entry of days.values()) {
      if (!busiestDay || entry.hours > busiestDay.hours) busiestDay = entry;
    }

    let busiestWeekday = null;
    weekdayHours.forEach((value, index) => {
      if (value > 0 && (!busiestWeekday || value > busiestWeekday.hours)) {
        busiestWeekday = { index, label: WEEKDAYS[index], hours: value, count: weekdayCounts[index] };
      }
    });

    let busiestHour = null;
    hourHours.forEach((value, hour) => {
      if (value > 0 && (!busiestHour || value > busiestHour.hours)) {
        busiestHour = { hour, label: `${pad(hour)}:00`, hours: value, count: hourCounts[hour] };
      }
    });

    return {
      totals: {
        bookings,
        hours,
        avgHours: bookings > 0 ? hours / bookings : 0,
        activeResources: enriched.filter((resource) => resource.bookings > 0).length,
        resourceCount: enriched.length,
        days: periodDays,
      },
      days: Object.fromEntries(days),
      weekdays: WEEKDAYS.map((label, index) => ({
        index,
        label,
        hours: weekdayHours[index],
        count: weekdayCounts[index],
      })),
      hours: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        label: `${pad(hour)}:00`,
        hours: hourHours[hour],
        count: hourCounts[hour],
      })),
      lengths,
      resources: enriched,
      busiest: { day: busiestDay, weekday: busiestWeekday, hour: busiestHour },
      periodDays,
    };
  }

  function mondayOnOrBefore(date) {
    const offset = weekdayIndex(date);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
  }

  function sundayOnOrAfter(date) {
    const offset = weekdayIndex(date);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + (6 - offset));
  }

  /**
   * GitHub-style daily grid: Monday-aligned weeks, one cell per day. The
   * intensity scale uses the 95th percentile of daily hours, so a single
   * outlier does not wash out the rest of the year.
   */
  function heatmap(model, period) {
    const days = model?.days || {};
    const start = startOfDay(period.start);
    const end = startOfDay(period.end);
    const gridStart = mondayOnOrBefore(start);
    const gridEnd = sundayOnOrAfter(end);

    const values = Object.values(days)
      .filter((entry) => entry.hours > 0)
      .map((entry) => entry.hours)
      .sort((a, b) => a - b);
    const max = values.length
      ? values[Math.min(values.length - 1, Math.floor(values.length * 0.95))]
      : 0;

    const weeks = [];
    let cursor = new Date(gridStart);
    let previousMonth = "";

    while (cursor <= gridEnd) {
      const week = { days: [], month: "" };
      for (let index = 0; index < 7; index += 1) {
        const date = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + index);
        const key = dayKey(date);
        const inPeriod = date >= start && date <= end;
        const entry = inPeriod ? days[key] : null;
        const hours = entry ? entry.hours : 0;
        const level = !inPeriod || hours <= 0 || max <= 0
          ? 0
          : Math.min(4, 1 + Math.floor((hours / max) * 3.999));
        week.days.push({
          key,
          date,
          inPeriod,
          count: entry ? entry.count : 0,
          hours,
          level,
        });
      }

      const first = week.days.find((day) => day.inPeriod) || week.days[0];
      const month = monthKey(first.date);
      if (month !== previousMonth) {
        week.month = monthLabel(month);
        previousMonth = month;
      }

      weeks.push(week);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
    }

    return { weeks, maxHours: max, start: gridStart, end: gridEnd };
  }

  function formatHours(hours) {
    if (!Number.isFinite(hours) || hours <= 0) return "0 h";
    if (hours < 10) return `${hours.toFixed(1)} h`;
    return `${Math.round(hours).toLocaleString("en-GB")} h`;
  }

  function formatRate(rate) {
    if (!Number.isFinite(rate) || rate <= 0) return "—";
    if (rate < 0.1) return "<0.1 h/day";
    return `${rate.toFixed(1)} h/day`;
  }

  globalThis.OneJobStats = {
    PERIODS,
    aggregate,
    bandForRate,
    dayKey,
    filterResources,
    formatHours,
    formatRate,
    heatmap,
    monthKey,
    monthKeys,
    monthLabel,
    monthStart,
    nextMonthStart,
    normalizeRecords,
    periodFor,
    periodLabel,
  };
})();
