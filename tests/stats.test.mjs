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

test("normalizeRecords keeps a linked record per resource when asked", () => {
  const parse = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : { stamp: date.getTime() };
  };
  const payload = [
    { id: 7, resourceId: 10, isLinked: false, start: "2026-01-05T10:00:00Z", end: "2026-01-05T11:30:00Z" },
    { id: 7, resourceId: 11, isLinked: true, start: "2026-01-05T10:00:00Z", end: "2026-01-05T11:30:00Z" },
  ];

  assert.equal(plain(S.normalizeRecords(payload, parse)).length, 1);
  const perResource = plain(S.normalizeRecords(payload, parse, { perResource: true }));
  assert.equal(perResource.length, 2);
  assert.deepEqual(
    perResource.map((record) => record.resourceId),
    ["10", "11"],
  );
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

/** Local wall-clock stamp in the dayGrid tests' window (November 2026). */
function nov(day, hour, minute = 0) {
  return new Date(2026, 10, day, hour, minute).getTime();
}

test("dayGrid lays out four Monday-aligned weeks and four blocks", () => {
  const model = S.dayGrid([], [{ id: "10" }], { now: new Date(2026, 10, 11, 14, 30) });

  assert.equal(model.days.length, 28);
  assert.equal(model.days[0].key, "2026-11-02");
  assert.equal(model.days[0].date.getDate(), 2);
  assert.equal(model.days[27].key, "2026-11-29");
  assert.equal(model.days[27].date.getDate(), 29);
  assert.deepEqual(
    plain(model.weeks.map((week) => week.label)),
    ["Last week", "This week", "Next week", "In 2 weeks"],
  );
  assert.deepEqual(
    plain(model.rows.map((row) => row.label)),
    ["Morning", "Afternoon", "Evening", "Night"],
  );
  assert.deepEqual(
    plain(model.rows.map((row) => [row.from, row.to])),
    [[6, 12], [12, 18], [18, 24], [0, 6]],
  );
  assert.equal(model.rows[0].days.length, 28);
  assert.equal(model.days[7].weekIndex, 1);
});

test("dayGrid honours daysBack and daysAhead", () => {
  const model = S.dayGrid([], [{ id: "10" }], {
    now: new Date(2026, 10, 11, 12),
    daysBack: 0,
    daysAhead: 14,
  });

  assert.equal(model.days.length, 14);
  assert.equal(model.days[0].key, "2026-11-09");
  assert.deepEqual(plain(model.weeks.map((week) => week.label)), ["This week", "Next week"]);
});

test("dayGrid splits bookings across days and blocks", () => {
  const records = [
    { id: "1", resourceId: "10", start: nov(2, 9), end: nov(2, 11) },
    { id: "2", resourceId: "10", start: nov(3, 18), end: nov(3, 20) },
    // Crosses midnight: one hour in Wednesday's evening block, five in
    // Thursday's night block.
    { id: "3", resourceId: "10", start: nov(4, 23), end: nov(5, 5) },
    // A different resource is not part of this grid.
    { id: "4", resourceId: "11", start: nov(6, 9), end: nov(6, 12) },
  ];
  const model = S.dayGrid(records, [{ id: "10" }], { now: new Date(2026, 10, 11, 12) });

  const row = (label) => model.rows.find((entry) => entry.label === label);
  const cell = (label, day) =>
    row(label).days.find((entry) => entry.date.getMonth() === 10 && entry.date.getDate() === day);

  assert.equal(cell("Morning", 2).hours, 2);
  assert.equal(cell("Morning", 2).count, 1);
  assert.equal(cell("Morning", 2).share, 2 / 6);
  assert.equal(cell("Morning", 2).level, 3);

  assert.equal(cell("Evening", 3).hours, 2);
  assert.equal(cell("Evening", 4).hours, 1);
  assert.equal(cell("Evening", 4).level, 2);
  assert.equal(cell("Night", 5).hours, 5);
  assert.equal(cell("Night", 5).level, 4);
  assert.equal(cell("Morning", 5).hours, 0);
  assert.equal(cell("Morning", 6).hours, 0);
});

test("dayGrid bands a block's booked share", () => {
  const records = [
    // 0.6 h = 10% of a block.
    { id: "1", resourceId: "10", start: nov(2, 6), end: nov(2, 6, 36) },
    // 1.8 h = 30%.
    { id: "2", resourceId: "10", start: nov(3, 6), end: nov(3, 7, 48) },
    // 3.6 h = 60%.
    { id: "3", resourceId: "10", start: nov(4, 6), end: nov(4, 9, 36) },
    // 4.5 h = 75%.
    { id: "4", resourceId: "10", start: nov(5, 6), end: nov(5, 10, 30) },
  ];
  const model = S.dayGrid(records, [{ id: "10" }], { now: new Date(2026, 10, 11, 12) });
  const morning = model.rows.find((row) => row.label === "Morning");
  const levels = morning.days
    .filter((day) => day.date.getMonth() === 10 && day.date.getDate() <= 6)
    .map((day) => day.level);

  assert.deepEqual(plain(levels), [1, 2, 3, 4, 0]);
});

test("dayGrid marks Luma events on the blocks they overlap", () => {
  const events = [
    { name: "Breakfast", start: nov(3, 9), end: nov(3, 11) },
    { name: "Workshop", start: nov(4, 17), end: nov(4, 19) },
    // Outside the 28-day window.
    { name: "Outside", start: nov(30, 9), end: nov(30, 10) },
  ];
  const model = S.dayGrid([], [{ id: "10" }], {
    now: new Date(2026, 10, 11, 12),
    events,
  });
  const row = (label) => model.rows.find((entry) => entry.label === label);
  const cell = (label, day) =>
    row(label).days.find((entry) => entry.date.getMonth() === 10 && entry.date.getDate() === day);

  assert.equal(cell("Morning", 3).eventCount, 1);
  assert.deepEqual(plain(cell("Morning", 3).eventNames), ["Breakfast"]);
  assert.deepEqual(plain(cell("Morning", 3).eventStarts), [nov(3, 9)]);
  // Events mark a cell; they never make it look booked.
  assert.equal(cell("Morning", 3).hours, 0);
  assert.equal(cell("Morning", 3).level, 0);

  // 17:00-19:00 covers the last afternoon hour and the first evening one.
  assert.equal(cell("Afternoon", 4).eventCount, 1);
  assert.deepEqual(plain(cell("Afternoon", 4).eventNames), ["Workshop"]);
  assert.equal(cell("Evening", 4).eventCount, 1);
  assert.equal(cell("Morning", 4).eventCount, 0);

  const total = model.rows.reduce(
    (sum, entry) => sum + entry.days.reduce((count, day) => count + day.eventCount, 0),
    0,
  );
  assert.equal(total, 3);
});

test("dayGrid marks the member's own bookings", () => {
  const mine = [
    { start: nov(3, 9), end: nov(3, 11) },
    { start: nov(4, 17), end: nov(4, 19) },
    // Outside the 28-day window.
    { start: nov(30, 9), end: nov(30, 10) },
  ];
  const model = S.dayGrid([], [{ id: "10" }], {
    now: new Date(2026, 10, 11, 12),
    mine,
  });
  const row = (label) => model.rows.find((entry) => entry.label === label);
  const cell = (label, day) =>
    row(label).days.find((entry) => entry.date.getMonth() === 10 && entry.date.getDate() === day);

  assert.equal(cell("Morning", 3).mine, true);
  // A marker, not a booking: the level stays empty.
  assert.equal(cell("Morning", 3).hours, 0);
  assert.equal(cell("Morning", 3).level, 0);
  assert.equal(cell("Afternoon", 4).mine, true);
  assert.equal(cell("Evening", 4).mine, true);
  assert.equal(cell("Morning", 4).mine, false);

  const total = model.rows.reduce(
    (sum, entry) => sum + entry.days.reduce((count, day) => count + (day.mine ? 1 : 0), 0),
    0,
  );
  assert.equal(total, 3);
});

/**
 * `/api/public/bookings/my` only lists active bookings, so a booking that has
 * finished has to be recognised in the calendar feed instead: by the member
 * the feed names, or by the id a linked booking repeats on every resource.
 */
test("dayGrid marks a finished booking of the member's by the feed's coworker", () => {
  const records = [
    {
      id: "7",
      resourceId: "10",
      start: nov(10, 9),
      end: nov(10, 11),
      coworkerId: "5001",
      coworkerName: "Alex Kim",
    },
    {
      id: "8",
      resourceId: "10",
      start: nov(10, 13),
      end: nov(10, 15),
      coworkerId: "5002",
      coworkerName: "Sam Ortiz",
    },
  ];
  const model = S.dayGrid(records, [{ id: "10" }], {
    now: new Date(2026, 10, 11, 12),
    me: { id: "5001", name: "Alex Kim" },
  });
  const row = (label) => model.rows.find((entry) => entry.label === label);
  const cell = (label, day) =>
    row(label).days.find((entry) => entry.date.getMonth() === 10 && entry.date.getDate() === day);

  assert.equal(cell("Morning", 10).mine, true);
  assert.equal(cell("Afternoon", 10).mine, false);

  // Without the id the name still identifies the member.
  const byName = S.dayGrid(records, [{ id: "10" }], {
    now: new Date(2026, 10, 11, 12),
    me: { id: "", name: "Alex Kim" },
  });
  const named = byName.rows.find((entry) => entry.label === "Morning").days.find(
    (entry) => entry.date.getDate() === 10,
  );
  assert.equal(named.mine, true);
});

test("dayGrid marks a linked booking of the member's by id", () => {
  const records = [
    // The member booked the lab; the feed repeats that booking on the machine
    // it blocks, under the same id and another resource.
    {
      id: "42",
      resourceId: "10",
      start: nov(5, 9),
      end: nov(5, 11),
      linked: true,
      coworkerId: "5009",
      coworkerName: "Someone Else",
    },
  ];
  const mine = [{ id: "42", resourceId: "99", start: nov(5, 9), end: nov(5, 11) }];
  const model = S.dayGrid(records, [{ id: "10" }], {
    now: new Date(2026, 10, 11, 12),
    mine,
  });
  const row = (label) => model.rows.find((entry) => entry.label === label);
  const cell = (label, day) =>
    row(label).days.find((entry) => entry.date.getMonth() === 10 && entry.date.getDate() === day);

  assert.equal(cell("Morning", 5).mine, true);
  assert.equal(cell("Morning", 5).linked, true);

  // A booking of the member's on another resource with its own id is not this
  // machine's, so it marks nothing here.
  const elsewhere = S.dayGrid(records, [{ id: "10" }], {
    now: new Date(2026, 10, 11, 12),
    mine: [{ id: "43", resourceId: "99", start: nov(6, 9), end: nov(6, 11) }],
  });
  const other = elsewhere.rows.find((entry) => entry.label === "Morning").days.find(
    (entry) => entry.date.getDate() === 5,
  );
  assert.equal(other.mine, false);
});

test("dayGrid counts workshop reservations as occupied", () => {
  const reserved = [{ name: "CNC Workshop", start: nov(20, 9), end: nov(20, 12) }];
  const model = S.dayGrid([], [{ id: "10" }], {
    now: new Date(2026, 10, 11, 12),
    reserved,
  });
  const row = (label) => model.rows.find((entry) => entry.label === label);
  const morning = row("Morning").days.find(
    (entry) => entry.date.getMonth() === 10 && entry.date.getDate() === 20,
  );

  assert.equal(morning.count, 0);
  assert.equal(morning.hours, 0);
  assert.equal(morning.reservedCount, 1);
  assert.equal(morning.reservedHours, 3);
  assert.deepEqual(plain(morning.reservedNames), ["CNC Workshop"]);
  assert.deepEqual(plain(morning.reservedStarts), [nov(20, 9)]);
  // 3 h of a 6 h block is 50%, so the cell no longer looks free.
  assert.equal(morning.share, 0.5);
  assert.equal(morning.level, 3);
});

test("dayGrid adds bookings and reservations for the level", () => {
  const records = [{ id: "1", resourceId: "10", start: nov(20, 6), end: nov(20, 9) }];
  const reserved = [{ name: "CNC Workshop", start: nov(20, 9), end: nov(20, 12) }];
  const model = S.dayGrid(records, [{ id: "10" }], {
    now: new Date(2026, 10, 11, 12),
    reserved,
  });
  const morning = model.rows
    .find((entry) => entry.label === "Morning")
    .days.find((entry) => entry.date.getMonth() === 10 && entry.date.getDate() === 20);

  assert.equal(morning.hours, 3);
  assert.equal(morning.reservedHours, 3);
  assert.equal(morning.share, 1);
  assert.equal(morning.level, 4);
});

test("dayGrid counts a linked booking on the resource it is linked to", () => {
  const parse = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : { stamp: date.getTime() };
  };
  const start = nov(10, 10);
  const end = nov(10, 11, 30);
  const payload = [
    { id: 7, resourceId: 10, start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    {
      id: 7,
      resourceId: 11,
      isLinked: true,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    },
  ];
  const records = S.normalizeRecords(payload, parse, { perResource: true });
  const model = S.dayGrid(records, [{ id: "11" }], { now: new Date(2026, 10, 11, 12) });
  const morning = model.rows
    .find((row) => row.label === "Morning")
    .days.find((day) => day.key === "2026-11-10");

  assert.equal(morning.count, 1);
  assert.equal(morning.hours, 1.5);
  assert.equal(morning.level, 2);
  assert.equal(morning.linked, true);
});

test("an empty dayGrid is still four rows of zero levels", () => {
  const model = S.dayGrid([], [{ id: "10" }], { now: new Date(2026, 10, 11, 12) });

  assert.equal(model.rows.length, 4);
  assert.equal(model.days.length, 28);
  for (const row of model.rows) {
    for (const day of row.days) {
      assert.equal(day.hours, 0);
      assert.equal(day.share, 0);
      assert.equal(day.level, 0);
    }
  }
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
