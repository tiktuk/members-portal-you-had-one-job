import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

function loadStats() {
  const context = vm.createContext({ console, Date, Intl });
  vm.runInContext(readFileSync(join(src, "lib/stats.js"), "utf8"), context, {
    filename: "lib/stats.js",
  });
  return context.OneJobStats;
}

const S = loadStats();

/** Values created inside the vm context use a different realm's prototypes. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const RESOURCES = [
  { id: "10", name: "Large CNC", group: "Machines: CNC", type: "machines" },
  { id: "11", name: "Laser", group: "Machines: Laser", type: "machines" },
  { id: "12", name: "Lab", group: "Labs: Outdoor", type: "labs" },
];

/** Local wall-clock stamp, so the tests do not depend on the CI timezone. */
function at(day, hour, minute = 0) {
  return new Date(2026, 0, day, hour, minute).getTime();
}

test("periodFor ends today and starts on the right day", () => {
  const now = new Date(2026, 10, 11, 14, 30);

  const year = S.periodFor("12m", now);
  assert.equal(year.start.getFullYear(), 2025);
  assert.equal(year.start.getMonth(), 10);
  assert.equal(year.start.getDate(), 11);
  assert.equal(year.start.getHours(), 0);
  assert.equal(year.end.getTime(), now.getTime());

  const quarter = S.periodFor("3m", now);
  assert.equal(quarter.start.getMonth(), 7);
  assert.equal(quarter.start.getDate(), 11);

  const weeks = S.periodFor("4w", now);
  assert.equal(weeks.start.getMonth(), 9);
  assert.equal(weeks.start.getDate(), 15);
});

test("periodFor clamps to the target month's last day", () => {
  const period = S.periodFor("3m", new Date(2026, 4, 31));
  assert.equal(period.start.getMonth(), 1);
  assert.equal(period.start.getDate(), 28);
});

test("periodFor gives a year's worth of days", () => {
  const period = S.periodFor("12m", new Date(2026, 10, 11, 12));
  const model = S.aggregate([], [], period);
  assert.ok(model.periodDays >= 365 && model.periodDays <= 367);
});

test("monthKeys covers every touched calendar month", () => {
  const keys = S.monthKeys(new Date(2025, 10, 11), new Date(2026, 10, 11));
  assert.equal(keys[0], "2025-11");
  assert.equal(keys[keys.length - 1], "2026-11");
  assert.equal(keys.length, 13);
  assert.equal(S.monthLabel("2026-01"), "Jan");
  assert.equal(S.monthStart("2026-01").getDate(), 1);
  assert.equal(S.nextMonthStart("2026-12").getFullYear(), 2027);
});

test("normalizeRecords drops events, invalid spans and duplicates", () => {
  const parse = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : { stamp: date.getTime() };
  };
  const payload = [
    { id: 1, resourceId: 10, start: "2026-01-05T10:00:00Z", end: "2026-01-05T12:00:00Z" },
    { id: 1, resourceId: 10, start: "2026-01-05T10:00:00Z", end: "2026-01-05T12:00:00Z" },
    { id: 2, resourceId: 0, start: "2026-01-05T10:00:00Z", end: "2026-01-05T12:00:00Z" },
    { id: 5, resourceId: 12, event: true, start: "2026-01-05T10:00:00Z", end: "2026-01-05T12:00:00Z" },
    { id: 3, resourceId: 11, start: "2026-01-05T12:00:00Z", end: "2026-01-05T10:00:00Z" },
    { id: 4, resourceId: 11, start: "nope", end: "2026-01-05T10:00:00Z" },
  ];

  const records = plain(S.normalizeRecords(payload, parse));
  assert.equal(records.length, 1);
  assert.equal(records[0].id, "1");
  assert.equal(records[0].resourceId, "10");
  assert.equal(records[0].start, new Date("2026-01-05T10:00:00Z").getTime());
  assert.equal(records[0].end, new Date("2026-01-05T12:00:00Z").getTime());
});

test("aggregate clips, splits days and hours, and keeps zero-booking resources", () => {
  const start = new Date(2026, 0, 5);
  const end = new Date(2026, 0, 7);
  const records = [
    { id: "a", resourceId: "10", start: at(5, 22), end: at(6, 2) },
    { id: "b", resourceId: "10", start: at(6, 9), end: at(6, 11) },
    { id: "c", resourceId: "11", start: at(5, 10), end: at(5, 11) },
  ];
  const model = S.aggregate(records, RESOURCES, { start, end }, { bands: [0.5, 1.5, 3] });

  assert.equal(model.totals.bookings, 3);
  assert.equal(model.totals.hours, 7);
  assert.equal(model.totals.activeResources, 2);
  assert.equal(model.totals.resourceCount, 3);
  assert.equal(model.totals.days, 2);

  assert.deepEqual(plain(model.days["2026-01-05"]), {
    key: "2026-01-05",
    count: 2,
    hours: 3,
  });
  assert.deepEqual(plain(model.days["2026-01-06"]), {
    key: "2026-01-06",
    count: 2,
    hours: 4,
  });

  const cnc = model.resources.find((resource) => resource.id === "10");
  assert.equal(cnc.bookings, 2);
  assert.equal(cnc.hours, 6);
  assert.equal(cnc.activeDays, 2);
  assert.equal(cnc.rate, 3);
  assert.equal(cnc.band, 3);
  assert.equal(cnc.share, 6 / 7);

  const laser = model.resources.find((resource) => resource.id === "11");
  assert.equal(laser.rate, 0.5);
  assert.equal(laser.band, 1);

  const lab = model.resources.find((resource) => resource.id === "12");
  assert.equal(lab.bookings, 0);
  assert.equal(lab.band, 0);

  assert.equal(model.busiest.weekday.index, 1);
  assert.equal(model.busiest.hour.hour, 10);
  assert.equal(model.busiest.hour.hours, 2);
  assert.equal(model.busiest.day.key, "2026-01-06");

  assert.deepEqual(plain(model.lengths.map((bucket) => bucket.count)), [0, 1, 1, 1, 0]);
});

test("aggregate clips a booking that starts before the period", () => {
  const start = new Date(2026, 0, 5);
  const end = new Date(2026, 0, 5, 12);
  const records = [{ id: "x", resourceId: "10", start: at(4, 22), end: at(5, 2) }];

  const model = S.aggregate(records, RESOURCES, { start, end });
  assert.equal(model.totals.bookings, 1);
  assert.equal(model.totals.hours, 2);
  assert.equal(model.days["2026-01-05"].hours, 2);
});

test("aggregate ignores unknown resources and duplicate records", () => {
  const start = new Date(2026, 0, 5);
  const end = new Date(2026, 0, 6);
  const records = [
    { id: "a", resourceId: "999", start: at(5, 10), end: at(5, 11) },
    { id: "b", resourceId: "10", start: at(5, 10), end: at(5, 11) },
    { id: "b", resourceId: "10", start: at(5, 10), end: at(5, 11) },
  ];

  const model = S.aggregate(records, RESOURCES, { start, end });
  assert.equal(model.totals.bookings, 1);
  assert.equal(model.totals.hours, 1);
});

test("heatmap aligns weeks to Monday and marks days outside the period", () => {
  const start = new Date(2026, 0, 7);
  const end = new Date(2026, 0, 9);
  const model = S.aggregate([], RESOURCES, { start, end });
  const heat = S.heatmap(model, { start, end });

  assert.equal(heat.weeks.length, 1);
  assert.equal(heat.weeks[0].days[0].key, "2026-01-05");
  assert.equal(heat.weeks[0].days[0].inPeriod, false);
  assert.equal(heat.weeks[0].days[2].inPeriod, true);
  assert.equal(heat.weeks[0].days[6].inPeriod, false);
  assert.equal(heat.weeks[0].month, "Jan");
  assert.equal(heat.maxHours, 0);
});

test("heatmap levels scale to the busiest day", () => {
  const start = new Date(2026, 0, 5);
  const end = new Date(2026, 0, 8);
  const records = [
    { id: "a", resourceId: "10", start: at(5, 9), end: at(5, 17) },
    { id: "b", resourceId: "11", start: at(6, 9), end: at(6, 10) },
  ];
  const model = S.aggregate(records, RESOURCES, { start, end });
  const heat = S.heatmap(model, { start, end });

  const monday = heat.weeks[0].days[0];
  const tuesday = heat.weeks[0].days[1];
  assert.equal(monday.hours, 8);
  assert.equal(monday.level, 4);
  assert.ok(tuesday.level >= 1 && tuesday.level < 4);
});

test("filterResources narrows a menu scope", () => {
  assert.equal(S.filterResources(RESOURCES, null).length, 3);
  assert.equal(S.filterResources(RESOURCES, {}).length, 3);
  assert.deepEqual(
    plain(S.filterResources(RESOURCES, { type: "machines" }).map((resource) => resource.id)),
    ["10", "11"],
  );
  assert.deepEqual(
    plain(
      S.filterResources(RESOURCES, { type: "machines", group: "Machines: CNC" }).map(
        (resource) => resource.id,
      ),
    ),
    ["10"],
  );
  assert.deepEqual(plain(S.filterResources(RESOURCES, { type: "labs", group: "Machines: CNC" })), []);
});

test("bands and formatters", () => {  const bands = [0.5, 1.5, 3];
  assert.equal(S.bandForRate(0, bands), 0);
  assert.equal(S.bandForRate(0.4, bands), 1);
  assert.equal(S.bandForRate(0.5, bands), 1);
  assert.equal(S.bandForRate(0.6, bands), 2);
  assert.equal(S.bandForRate(1.5, bands), 2);
  assert.equal(S.bandForRate(1.6, bands), 3);
  assert.equal(S.bandForRate(3, bands), 3);
  assert.equal(S.bandForRate(3.1, bands), 4);

  assert.equal(S.formatHours(0), "0 h");
  assert.equal(S.formatHours(1.2), "1.2 h");
  assert.equal(S.formatHours(12.4), "12 h");
  assert.equal(S.formatRate(0), "—");
  assert.equal(S.formatRate(0.05), "<0.1 h/day");
  assert.equal(S.formatRate(2.1), "2.1 h/day");
});

test("an empty period still produces a grid and zero totals", () => {
  const start = new Date(2026, 0, 5);
  const end = new Date(2026, 0, 6);
  const model = S.aggregate([], [], { start, end });

  assert.equal(model.totals.bookings, 0);
  assert.equal(model.totals.hours, 0);
  assert.equal(model.totals.avgHours, 0);
  assert.equal(model.totals.resourceCount, 0);
  assert.equal(model.busiest.day, null);
  assert.equal(model.busiest.weekday, null);
  assert.equal(model.busiest.hour, null);
  assert.deepEqual(plain(model.lengths.map((bucket) => bucket.count)), [0, 0, 0, 0, 0]);

  const heat = S.heatmap(model, { start, end });
  assert.ok(heat.weeks.length >= 1);
  assert.equal(heat.maxHours, 0);
});
