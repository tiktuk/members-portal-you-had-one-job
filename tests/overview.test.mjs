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
  return context.OneJobOverview;
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

function lumaEvent(overrides) {
  return {
    api_id: "evt-1",
    event: {
      api_id: "evt-1",
      name: "BreakfastInMotion",
      start_at: "2026-10-30T09:00:00.000Z",
      end_at: "2026-10-30T10:30:00.000Z",
      url: "breakfast",
      geo_address_info: { short_address: "Bouchéstraße 12, Berlin" },
      ...overrides,
    },
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
  assert.equal(model.cards[0].bookings[0].mine, false);
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

test("buildModel merges Luma events into every pinned card", () => {
  const O = loadOverview();
  const model = O.buildModel(
    PINS,
    [record({ id: 1, start: "2026-10-30T08:00Z", end: "2026-10-30T09:00Z" })],
    NOW,
    [],
    [lumaEvent()],
  );

  assert.equal(model.cards.length, 2);
  assert.equal(model.bookingCount, 1);
  assert.equal(model.eventCount, 0);
  assert.equal(model.lumaCount, 1);
  assert.equal(model.total, 2);

  for (const card of model.cards) {
    const luma = card.bookings.find((item) => item.luma);
    assert.ok(luma);
    assert.equal(luma.id, "luma-evt-1");
    assert.equal(luma.kind, "luma");
    assert.equal(luma.coworker, "BreakfastInMotion");
    assert.equal(luma.startTime, "10:00");
    assert.equal(luma.endTime, "11:30");
    assert.equal(luma.day, "2026-10-30");
    assert.equal(luma.url, "https://luma.com/breakfast");
  }

  assert.deepEqual(
    plain(model.cards[0].sections.map((section) => [section.day, section.label, section.bookings.length])),
    [["2026-10-30", "Fri", 2]],
  );
});

test("buildModel caps Luma events at ten per card", () => {
  const O = loadOverview();
  const events = Array.from({ length: 12 }, (_, index) =>
    lumaEvent({
      api_id: `evt-${String(index).padStart(2, "0")}`,
      start_at: `2026-10-30T09:${String(index).padStart(2, "0")}:00.000Z`,
      end_at: `2026-10-30T09:${String(index).padStart(2, "0")}:30.000Z`,
    }),
  );

  const model = O.buildModel(PINS, [], NOW, [], events);
  assert.equal(model.lumaCount, 10);
  assert.equal(model.cards[0].bookings.length, 10);
  assert.equal(model.cards[1].bookings.length, 10);
});

test("buildModel drops Luma events outside the lookahead window", () => {
  const O = loadOverview();
  const model = O.buildModel(PINS, [], NOW, [], [
    lumaEvent({ api_id: "evt-past", start_at: "2026-10-26T09:00:00.000Z", end_at: "2026-10-26T10:00:00.000Z" }),
    lumaEvent({ api_id: "evt-far", start_at: "2026-11-20T09:00:00.000Z", end_at: "2026-11-20T10:00:00.000Z" }),
    lumaEvent({ api_id: "evt-now", start_at: "2026-10-27T09:00:00.000Z", end_at: "2026-10-27T14:00:00.000Z" }),
  ]);

  assert.equal(model.lumaCount, 1);
  assert.equal(model.cards[0].bookings[0].id, "luma-evt-now");
});

test("normalizeLumaEvent ignores malformed entries", () => {
  const O = loadOverview();
  assert.equal(O.normalizeLumaEvent({}), null);
  assert.equal(O.normalizeLumaEvent({ event: { api_id: "evt-1" } }), null);
  assert.equal(
    O.normalizeLumaEvent({
      event: { api_id: "evt-1", start_at: "nope", end_at: "2026-10-30T10:00:00Z" },
    }),
    null,
  );
});

test("buildMyBookings merges Luma events and counts them separately", () => {
  const O = loadOverview();
  const model = O.buildMyBookings(
    [myRecord({ Id: 1 })],
    NOW,
    [lumaEvent({ start_at: "2026-10-28T09:00:00.000Z", end_at: "2026-10-28T10:00:00.000Z" })],
  );

  assert.equal(model.count, 1);
  assert.equal(model.eventCount, 1);
  assert.equal(model.items.length, 2);
  assert.equal(model.items[0].luma, false);
  assert.equal(model.items[1].luma, true);
  assert.deepEqual(
    plain(model.sections.map((section) => [section.day, section.label, section.bookings.length])),
    [
      ["2026-10-27", "Today", 1],
      ["2026-10-28", "Wed", 1],
    ],
  );
});

test("markOwnedBookings leaves Luma events unowned", () => {
  const O = loadOverview();
  const model = O.buildModel(PINS, [], NOW, [], [lumaEvent()]);
  O.markOwnedBookings(model, O.buildMyBookings([myRecord({ Id: 1 })], NOW));

  assert.equal(model.cards[0].bookings[0].luma, true);
  assert.equal(model.cards[0].bookings[0].mine, false);
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
  assert.equal(model.items[0].mine, true);
});

test("markOwnedBookings marks only the member's own pinned bookings", () => {
  const O = loadOverview();
  const model = O.buildModel(
    PINS,
    [
      record({ id: 1 }),
      record({ id: 2, start: "2026-10-28T10:00Z", end: "2026-10-28T12:00Z" }),
    ],
    NOW,
  );
  const myModel = O.buildMyBookings([myRecord({ Id: 1 })], NOW);
  O.markOwnedBookings(model, myModel);

  assert.equal(model.cards[0].bookings.find((item) => item.id === "1").mine, true);
  assert.equal(model.cards[0].bookings.find((item) => item.id === "2").mine, false);
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

test("bookingWindow butts the new slot against the row's fixed edge", () => {
  const O = loadOverview();
  const booking = { stamp: new Date(2026, 10, 3, 9, 0).getTime(), endStamp: new Date(2026, 10, 3, 13, 0).getTime() };

  assert.deepEqual(plain(O.bookingWindow(booking, "before", 60)), {
    start: new Date(2026, 10, 3, 8, 0).getTime(),
    end: booking.stamp,
  });
  assert.deepEqual(plain(O.bookingWindow(booking, "after", 30)), {
    start: booking.endStamp,
    end: new Date(2026, 10, 3, 13, 30).getTime(),
  });
});

test("bookingWindow crosses midnight without clamping", () => {
  const O = loadOverview();
  const booking = { stamp: new Date(2026, 10, 3, 0, 30).getTime(), endStamp: new Date(2026, 10, 3, 2, 0).getTime() };

  assert.deepEqual(plain(O.bookingWindow(booking, "before", 90)), {
    start: new Date(2026, 10, 2, 23, 0).getTime(),
    end: booking.stamp,
  });
});

test("bookingWindow rejects a bad side or duration", () => {
  const O = loadOverview();
  const booking = { stamp: 1000, endStamp: 2000 };
  assert.equal(O.bookingWindow(booking, "before", 0), null);
  assert.equal(O.bookingWindow(booking, "after", -30), null);
  assert.equal(O.bookingWindow(booking, "around", 30), null);
  assert.equal(O.bookingWindow(null, "after", 30), null);
});

test("basketBody mirrors the portal's booking form payload", () => {
  const O = loadOverview();
  const body = plain(
    O.basketBody({
      resourceId: "1415309596",
      coworkerId: "5001",
      coworkerName: "Alex Kim",
      start: new Date(Date.UTC(2026, 10, 3, 8, 0)),
      end: new Date(Date.UTC(2026, 10, 3, 9, 0)),
    }),
  );

  assert.deepEqual(body, {
    Basket: [
      {
        Type: "booking",
        Booking: {
          ResourceId: 1415309596,
          FromTime: "2026-11-03T08:00:00.000Z",
          ToTime: "2026-11-03T09:00:00.000Z",
          FloorPlanDeskId: null,
          CoworkerId: 5001,
          CoworkerFullName: "Alex Kim",
          ChargeNow: false,
          BookingVisitors: [],
          BookingProducts: [],
          CustomFields: { Data: [] },
          Id: 0,
        },
      },
    ],
    agreedTermsAndConditions: true,
    createZeroValueInvoice: true,
  });
});

test("basketBody leaves the name out when it is unknown", () => {
  const O = loadOverview();
  const body = plain(O.basketBody({ resourceId: 1, coworkerId: 2, start: 0, end: 3600000 }));
  assert.equal("CoworkerFullName" in body.Basket[0].Booking, false);
});

test("defaultProfile prefers the default profile, then the first", () => {
  const O = loadOverview();
  assert.deepEqual(
    plain(
      O.defaultProfile({
        Profiles: [
          { Id: 7, FullName: "Team Profile" },
          { Id: 5001, IsDefaultProfile: true, FullName: "Alex Kim" },
        ],
      }),
    ),
    { id: 5001, name: "Alex Kim" },
  );
  assert.deepEqual(plain(O.defaultProfile({ Profiles: [{ Id: 7, FullName: "Team" }] })), {
    id: 7,
    name: "Team",
  });
  assert.equal(O.defaultProfile({ Profiles: [] }), null);
  assert.equal(O.defaultProfile(null), null);
});

test("resourceInterval reads IntervalLimit and falls back to null", () => {
  const O = loadOverview();
  assert.equal(O.resourceInterval({ IntervalLimit: 30 }), 30);
  assert.equal(O.resourceInterval({ IntervalLimit: "15" }), 15);
  assert.equal(O.resourceInterval({ IntervalLimit: 0 }), null);
  assert.equal(O.resourceInterval({}), null);
});

test("durationLabel writes the portal's duration wording", () => {
  const O = loadOverview();
  assert.equal(O.durationLabel(30), "30 min");
  assert.equal(O.durationLabel(60), "1 h");
  assert.equal(O.durationLabel(90), "1 h 30 min");
});

test("bookingError translates the checkout codes it knows", () => {
  const O = loadOverview();
  assert.match(O.bookingError("BOOKING_CONFLICT"), /already booked/);
  assert.match(O.bookingError("INVALID_INTERVAL", 30), /blocks of 30 min/);
  assert.match(O.bookingError("TOO_LONG", 120), /Maximum duration is 2 h/);
  assert.match(O.bookingError("CHECKOUT TC MISSING"), /terms and conditions/);
  assert.equal(O.bookingError("SOMETHING_NEW"), null);
  assert.equal(O.bookingError(undefined), null);
});

test("cancelBody mirrors the portal's cancellation payload", () => {
  const O = loadOverview();
  assert.deepEqual(plain(O.cancelBody("9001", "NoLongerNeeded", "ignored")), {
    id: 9001,
    cancellationReason: "NoLongerNeeded",
    cancellationReasonDetails: "",
  });
  assert.deepEqual(plain(O.cancelBody(9001, "Other", "  machine broken  ")), {
    id: 9001,
    cancellationReason: "Other",
    cancellationReasonDetails: "  machine broken  ",
  });
});

test("cancelError translates the cancellation refusals", () => {
  const O = loadOverview();
  assert.match(O.cancelError("ALREADY_INVOICED"), /already been invoiced/);
  assert.match(O.cancelError("CANNOT_CANCEL_IF_STARTED"), /already started/);
  assert.match(O.cancelError("NO_ACCESS"), /permission/);
  assert.match(O.cancelError("BREAKS_CANCELLATION_POLICY|90"), /1 h 30 min before the start/);
  assert.match(O.cancelError("BREAKS_CANCELLATION_POLICY"), /cancellation policy window/);
  assert.equal(O.cancelError("SOMETHING_NEW"), null);
});

test("CANCEL_REASONS carries the portal's values and labels", () => {
  const O = loadOverview();
  assert.deepEqual(
    plain(O.CANCEL_REASONS.map((reason) => reason.value)),
    ["", "NoLongerNeeded", "TooExpensive", "BadPreviousExperience", "RebookedForADifferentTime", "Other"],
  );
  assert.equal(O.CANCEL_REASONS.find((reason) => reason.value === "Other").label, "Other");
});

/** A row of the model, from/to being hours on 3 Nov 2026. */
function slot(id, from, to, extra = {}) {
  return {
    id: String(id),
    resourceId: "1415309596",
    kind: "booking",
    stamp: new Date(2026, 10, 3, from, 0).getTime(),
    endStamp: new Date(2026, 10, 3, to, 0).getTime(),
    ...extra,
  };
}

test("rowGap measures the free time before and after a booking", () => {
  const O = loadOverview();
  const row = slot(2, 10, 12);
  const items = [slot(1, 8, 9), row, slot(3, 13, 14)];

  assert.equal(O.rowGap(items, row, "before"), 60 * 60 * 1000);
  assert.equal(O.rowGap(items, row, "after"), 60 * 60 * 1000);
});

test("rowGap is zero for back-to-back rows and negative for overlaps", () => {
  const O = loadOverview();
  const row = slot(2, 10, 12);

  assert.equal(O.rowGap([slot(1, 9, 10), row], row, "before"), 0);
  assert.equal(O.rowGap([row, slot(3, 12, 13)], row, "after"), 0);
  assert.ok(O.rowGap([slot(1, 9, 11), row], row, "before") < 0);
  assert.ok(O.rowGap([row, slot(3, 11, 13)], row, "after") < 0);
});

test("rowGap looks past the neighbouring row for a longer overlap", () => {
  const O = loadOverview();
  const long = slot(1, 8, 13);
  const row = slot(2, 9, 10);
  const next = slot(3, 11, 12);

  // `next` starts after the row ends, but `long` is still using the resource.
  assert.ok(O.rowGap([long, row, next], row, "after") <= 0);
  // ...and it is the frontier before `next`, not `row`'s end.
  assert.equal(O.rowGap([long, row, next], next, "before"), -2 * 60 * 60 * 1000);
});

test("rowGap ignores Luma events and rows of another resource", () => {
  const O = loadOverview();
  const row = slot(2, 10, 12);
  const luma = slot(3, 12, 13, { resourceId: "", kind: "luma" });
  const other = slot(4, 12, 13, { resourceId: "99" });

  assert.equal(O.rowGap([row, luma, other], row, "after"), Infinity);
});

test("rowGap is Infinity with no neighbours and 0 for a bad side", () => {
  const O = loadOverview();
  const row = slot(2, 10, 12);

  assert.equal(O.rowGap([row], row, "before"), Infinity);
  assert.equal(O.rowGap([], row, "after"), Infinity);
  assert.equal(O.rowGap([row], row, "around"), 0);
  assert.equal(O.rowGap([row], null, "after"), 0);
});
