import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

// The portal renders UTC instants in the browser's timezone; pin the tests to
// the space's timezone so the expected clock times do not depend on the machine.
process.env.TZ = "Europe/Berlin";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

function loadOverview() {
  const context = vm.createContext({ console });
  vm.runInContext(readFileSync(join(src, "lib/overview.js"), "utf8"), context, {
    filename: "lib/overview.js",
  });
  return context.NXPlusOverview;
}

/** Values created inside the vm context use a different realm's prototypes. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const NOW = new Date(2026, 9, 27, 12, 0, 0);

const PINS = [
  {
    id: "1415309596",
    name: "CNC Routermax 1325 Deluxe",
    group: "Machines: CNC Machining ",
    type: "machines",
  },
  {
    id: "1415309492",
    name: "xTool F1 ",
    group: "Machines: Laser Cutting ",
    type: "machines",
  },
];

function record(overrides) {
  return {
    id: 1,
    resourceId: 1415309596,
    resourceName: "CNC Routermax 1325 Deluxe",
    start: "2026-10-27T09:00Z",
    end: "2026-10-27T13:00Z",
    coworkerFullName: "Tuk Bredsdorff",
    tentative: false,
    event: false,
    allDay: false,
    ignoreTimezone: true,
    ...overrides,
  };
}

function event(overrides) {
  return {
    id: 100,
    resourceId: 1415309596,
    title: "Workshop - Introduction to 3-Axis CNC Machining",
    shortDescription: "Learn how to use the Routermax.",
    url: "/en/Events/View/100/workshop",
    start: "2026-10-30T10:00Z",
    end: "2026-10-30T16:00Z",
    allDay: false,
    event: true,
    ignoreTimezone: true,
    ...overrides,
  };
}

function myRecord(overrides) {
  return {
    Id: 1,
    ResourceId: 1415309476,
    ResourceName: 'GS 6090 PR - "Laser Catthi"',
    FromTime: "2026-10-27T13:00:00",
    ToTime: "2026-10-27T15:30:00",
    Tentative: false,
    Cancelled: false,
    ...overrides,
  };
}

test("buildModel keeps only pinned resources and upcoming bookings", () => {
  const O = loadOverview();
  const model = O.buildModel(
    PINS,
    [
      record({ id: 1 }),
      record({ id: 2, start: "2026-10-28T10:00Z", end: "2026-10-28T12:00Z" }),
      record({ id: 3, start: "2026-10-26T09:00Z", end: "2026-10-26T10:00Z" }),
      record({ id: 4, start: "2026-11-20T09:00Z", end: "2026-11-20T10:00Z" }),
      record({ id: 5, resourceId: 1415309492, start: "2026-10-29T08:00Z", end: "2026-10-29T09:00Z" }),
      record({ id: 6, resourceId: 999, start: "2026-10-28T08:00Z", end: "2026-10-28T09:00Z" }),
    ],
    NOW,
  );

  assert.equal(model.cards.length, 2);
  assert.equal(model.total, 3);
  assert.deepEqual(
    plain(model.cards[0].bookings.map((booking) => booking.id)),
    ["1", "2"],
  );
  assert.equal(model.cards[1].bookings[0].id, "5");
  assert.equal(model.cards[1].groupLabel, "Machines: Laser Cutting");
});

test("buildModel groups bookings into day sections with web-app labels", () => {
  const O = loadOverview();
  const model = O.buildModel(
    PINS,
    [
      record({ id: 1, start: "2026-10-27T09:00Z", end: "2026-10-27T13:00Z" }),
      record({ id: 2, start: "2026-10-27T14:00Z", end: "2026-10-27T15:00Z" }),
      record({ id: 3, start: "2026-10-28T10:00Z", end: "2026-10-28T12:00Z" }),
      record({ id: 4, start: "2026-11-02T10:00Z", end: "2026-11-02T12:00Z" }),
    ],
    NOW,
  );

  const sections = model.cards[0].sections;
  assert.deepEqual(
    plain(sections.map((section) => [section.day, section.label, section.bookings.length])),
    [
      ["2026-10-27", "Today", 2],
      ["2026-10-28", "Wed", 1],
      ["2026-11-02", "Mon", 1],
    ],
  );
});

test("booking timestamps are converted to the browser timezone", () => {
  const O = loadOverview();
  const model = O.buildModel(
    PINS,
    [record({ start: "2026-10-27T09:05Z", end: "2026-10-27T13:45Z" })],
    NOW,
  );

  const [booking] = model.cards[0].bookings;
  assert.equal(booking.startTime, "10:05");
  assert.equal(booking.endTime, "14:45");
  assert.equal(booking.day, "2026-10-27");
});

test("bookings and events are both converted from UTC", () => {
  const O = loadOverview();
  const model = O.buildModel(
    PINS,
    [record({ id: 1, start: "2026-10-30T09:00Z", end: "2026-10-30T10:00Z" })],
    NOW,
    [event({ id: 100, start: "2026-10-30T10:00Z", end: "2026-10-30T16:00Z" })],
  );

  const booking = model.cards[0].bookings.find((item) => !item.event);
  const workshop = model.cards[0].bookings.find((item) => item.event);
  assert.equal(booking.startTime, "10:00");
  assert.equal(workshop.startTime, "11:00");
});

test("buildModel keeps an ongoing booking that started yesterday", () => {
  const O = loadOverview();
  const model = O.buildModel(
    PINS,
    [record({ id: 7, start: "2026-10-26T22:00Z", end: "2026-10-27T14:00Z" })],
    NOW,
  );

  assert.equal(model.total, 1);
  assert.equal(model.cards[0].sections[0].label, "26 Oct");
});

test("buildModel de-duplicates repeated booking ids", () => {
  const O = loadOverview();
  const model = O.buildModel(PINS, [record({ id: 1 }), record({ id: 1 })], NOW);
  assert.equal(model.total, 1);
});

test("buildModel carries tentative and all-day flags", () => {
  const O = loadOverview();
  const model = O.buildModel(
    PINS,
    [
      record({ id: 1, tentative: true }),
      record({
        id: 2,
        start: "2026-10-28T00:00Z",
        end: "2026-10-29T00:00Z",
        allDay: true,
      }),
    ],
    NOW,
  );

  assert.equal(model.cards[0].bookings[0].tentative, true);
  assert.equal(model.cards[0].bookings[1].allDay, true);
});

test("buildModel merges resource events into the same day sections", () => {
  const O = loadOverview();
  const model = O.buildModel(
    PINS,
    [record({ id: 1, start: "2026-10-30T09:00Z", end: "2026-10-30T10:00Z" })],
    NOW,
    [event()],
  );

  assert.equal(model.total, 2);
  assert.equal(model.bookingCount, 1);
  assert.equal(model.eventCount, 1);
  assert.deepEqual(
    plain(model.cards[0].bookings.map((booking) => booking.id)),
    ["1", "event-100"],
  );
  assert.deepEqual(
    plain(model.cards[0].sections.map((section) => [section.day, section.label, section.bookings.length])),
    [["2026-10-30", "Fri", 2]],
  );

  const workshop = model.cards[0].bookings[1];
  assert.equal(workshop.event, true);
  assert.equal(workshop.startTime, "11:00");
  assert.equal(workshop.endTime, "17:00");
  assert.equal(workshop.coworker, "Workshop - Introduction to 3-Axis CNC Machining");
  assert.equal(workshop.description, "Learn how to use the Routermax.");
  assert.equal(workshop.url, "/en/Events/View/100/workshop");
});

test("buildModel ignores space-wide and unpinned events", () => {
  const O = loadOverview();
  const model = O.buildModel(
    PINS,
    [],
    NOW,
    [
      event({ id: 100, resourceId: 0 }),
      event({ id: 101, resourceId: 999 }),
      event({ id: 102, resourceId: 1415309492 }),
    ],
  );

  assert.equal(model.eventCount, 1);
  assert.equal(model.cards[0].bookings.length, 0);
  assert.equal(model.cards[1].bookings[0].id, "event-102");
});

test("event times are UTC instants regardless of ignoreTimezone", () => {
  const O = loadOverview();
  const withFlag = O.buildModel(PINS, [], NOW, [event({ ignoreTimezone: true })]);
  const withoutFlag = O.buildModel(PINS, [], NOW, [event({ ignoreTimezone: false })]);

  assert.equal(withFlag.cards[0].bookings[0].startTime, "11:00");
  assert.equal(withFlag.cards[0].bookings[0].endTime, "17:00");
  assert.equal(withoutFlag.cards[0].bookings[0].startTime, "11:00");
});

test("buildModel handles no pins and no records", () => {
  const O = loadOverview();
  assert.deepEqual(plain(O.buildModel([], [record()], NOW).cards), []);
  const model = O.buildModel(PINS, [], NOW);
  assert.equal(model.total, 0);
  assert.equal(model.cards[0].sections.length, 0);
});

test("normalizePins accepts ids, strings and drops empty entries", () => {
  const O = loadOverview();
  assert.deepEqual(plain(O.normalizePins([{ id: 42, name: "CNC" }, "7", null, {}])), [
    { id: "42", name: "CNC", group: "", type: "" },
    { id: "7", name: "", group: "", type: "" },
  ]);
  assert.deepEqual(plain(O.normalizePins("nope")), []);
});

test("resourceIcon mirrors the web app's keyword table", () => {
  const O = loadOverview();
  assert.equal(O.resourceIcon({ name: "CNC Routermax" }), "⚙️");
  assert.equal(O.resourceIcon({ name: "xTool F1" }), "⚡");
  assert.equal(O.resourceIcon({ name: "E-Lab" }), "🔌");
  assert.equal(O.resourceIcon({ name: "Random" }), "");
});

test("rangeFor covers today plus the 14-day lookahead", () => {
  const O = loadOverview();
  const { start, end } = O.rangeFor(NOW);

  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 9);
  assert.equal(start.getDate(), 27);
  assert.equal(start.getHours(), 0);
  assert.equal(end.getDate(), 10);
  assert.equal(end.getMonth(), 10);
  assert.equal(end.getHours(), 23);
});

test("buildMyBookings groups personal bookings by day with resource names", () => {
  const O = loadOverview();
  const model = O.buildMyBookings(
    [
      myRecord({ Id: 1 }),
      myRecord({
        Id: 2,
        ResourceId: 1415309596,
        ResourceName: "CNC Routermax 1325 Deluxe",
        FromTime: "2026-10-28T10:00:00",
        ToTime: "2026-10-28T17:00:00",
      }),
      myRecord({ Id: 3, FromTime: "2026-10-26T10:00:00", ToTime: "2026-10-26T11:00:00" }),
      myRecord({ Id: 4, Cancelled: true }),
      myRecord({
        Id: 5,
        FromTime: "2026-11-20T10:00:00",
        ToTime: "2026-11-20T11:00:00",
      }),
    ],
    NOW,
  );

  assert.equal(model.count, 2);
  assert.deepEqual(plain(model.items.map((item) => item.id)), ["1", "2"]);
  assert.deepEqual(
    plain(model.sections.map((section) => [section.day, section.label, section.bookings.length])),
    [
      ["2026-10-27", "Today", 1],
      ["2026-10-28", "Wed", 1],
    ],
  );
  assert.equal(model.items[0].coworker, 'GS 6090 PR - "Laser Catthi"');
  assert.equal(model.items[1].resourceName, "CNC Routermax 1325 Deluxe");
});

test("buildMyBookings keeps an ongoing booking and de-duplicates ids", () => {
  const O = loadOverview();
  const model = O.buildMyBookings(
    [
      myRecord({ Id: 1, FromTime: "2026-10-26T22:00:00", ToTime: "2026-10-27T14:00:00" }),
      myRecord({ Id: 1, FromTime: "2026-10-26T22:00:00", ToTime: "2026-10-27T14:00:00" }),
      myRecord({ Id: 2, Tentative: true }),
    ],
    NOW,
  );

  assert.equal(model.count, 2);
  assert.equal(model.items[0].tentative, false);
  assert.equal(model.items[1].tentative, true);
});

test("buildMyBookings handles no records", () => {
  const O = loadOverview();
  const model = O.buildMyBookings([], NOW);
  assert.equal(model.count, 0);
  assert.deepEqual(plain(model.sections), []);
});

test("toQueryTimestamp writes the local minute precision the API expects", () => {
  const O = loadOverview();
  assert.equal(O.toQueryTimestamp(new Date(2026, 9, 27, 0, 0, 0)), "2026-10-27T00:00");
  assert.equal(O.toQueryTimestamp(new Date(2026, 10, 10, 23, 59, 0)), "2026-11-10T23:59");
});

test("toPortalIso writes a local ISO timestamp with offset", () => {
  const O = loadOverview();
  const iso = O.toPortalIso(new Date(2026, 9, 27, 0, 0, 0, 0));
  assert.match(iso, /^2026-10-27T00:00:00\.000[+-]\d{2}:\d{2}$/);
});
