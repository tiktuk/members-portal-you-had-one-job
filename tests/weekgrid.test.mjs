import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

function loadGrid() {
  const context = vm.createContext({ console, Date, Intl });
  vm.runInContext(readFileSync(join(src, "lib/weekgrid.js"), "utf8"), context, {
    filename: "lib/weekgrid.js",
  });
  return context.OneJobWeekGrid;
}

const W = loadGrid();

/** Values created inside the vm context use a different realm's prototypes. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const RESOURCES = [
  { id: "10", name: "Large CNC" },
  { id: "11", name: "Laser" },
];

/** January 2026: the 5th is a Monday. Local wall-clock stamps, timezone-proof. */
function at(day, hour, minute = 0) {
  return new Date(2026, 0, day, hour, minute).getTime();
}

const WEEK = new Date(2026, 0, 7);
const NOW = new Date(2026, 0, 7, 12, 0);

function record(id, resourceId, start, end, extra = {}) {
  return { id, resourceId, start, end, linked: false, coworkerId: "", coworkerName: "", ...extra };
}

function grid(records, options = {}) {
  return W.weekGrid(records, RESOURCES, { weekStart: WEEK, now: NOW, ...options });
}

test("weekRange aligns to Monday and steps by weeks", () => {
  const range = W.weekRange(new Date(2026, 0, 11));
  assert.equal(range.start.getTime(), new Date(2026, 0, 5).getTime());
  assert.equal(range.end.getTime(), new Date(2026, 0, 12).getTime());
  assert.equal(W.weekRange(new Date(2026, 0, 7), 1).start.getTime(), new Date(2026, 0, 12).getTime());
  assert.equal(W.weekRange(new Date(2026, 0, 7), -1).start.getTime(), new Date(2025, 11, 29).getTime());
});

test("visibleDays hides elapsed days only in the current week", () => {
  const current = grid([]);
  assert.deepEqual(
    plain(W.visibleDays(current.days).map((day) => day.key)),
    ["2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"],
  );

  const previous = W.weekGrid([], RESOURCES, {
    weekStart: new Date(2025, 11, 31),
    now: NOW,
  });
  assert.equal(W.visibleDays(previous.days).length, 7);
});

test("machineColorMap gives related models one hue and different shades", () => {
  const colors = W.machineColorMap([
    { id: "w1", name: "WASP 3MT Industrial" },
    { id: "w2", name: "WASP 2040 Turbo2" },
    { id: "w3", name: "WASP 4070 Industrial" },
    { id: "p1", name: "Prusa - MK4" },
    { id: "p2", name: "Prusa - XL" },
    { id: "h1", name: "Band saw - Hammer N4400" },
    { id: "h2", name: "Table saw / Router table - Hammer B3 winner" },
  ]);
  const wasps = ["w1", "w2", "w3"].map((id) => colors.get(id));
  const prusas = ["p1", "p2"].map((id) => colors.get(id));
  const hammers = ["h1", "h2"].map((id) => colors.get(id));

  assert.equal(new Set(wasps.map((entry) => entry.family)).size, 1);
  assert.equal(new Set(wasps.map((entry) => entry.paletteIndex)).size, 1);
  assert.equal(new Set(wasps.map((entry) => entry.shade)).size, 3);
  assert.notEqual(wasps[0].paletteIndex, prusas[0].paletteIndex);
  assert.equal(hammers[0].family, hammers[1].family);
  assert.equal(hammers[0].paletteIndex, hammers[1].paletteIndex);
  assert.notEqual(hammers[0].shade, hammers[1].shade);
});

test("the grid has seven days with one column per resource in order", () => {
  const model = grid([]);
  assert.equal(model.days.length, 7);
  assert.deepEqual(
    plain(model.days.map((day) => day.key)),
    ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"],
  );
  for (const day of model.days) {
    assert.deepEqual(
      plain(day.columns.map((column) => column.resourceId)),
      ["10", "11"],
    );
  }
  assert.deepEqual(
    plain(model.days.map((day) => day.isWeekend)),
    [false, false, false, false, false, true, true],
  );
  assert.equal(model.days[2].isToday, true);
  assert.equal(model.days[1].isPast, true);
  assert.equal(model.days[3].isPast, false);
});

test("the default window is 06:00 to 22:00 and blocks are positioned in it", () => {
  const model = grid([record("a", "10", at(7, 10), at(7, 12))]);
  assert.equal(model.hourFrom, 6);
  assert.equal(model.hourTo, 22);
  assert.equal(model.hours.length, 16);
  assert.equal(model.hours[0].label, "06:00");

  const [block] = model.days[2].columns[0].blocks;
  assert.equal(block.top, (4 / 16) * 100);
  assert.equal(block.height, (2 / 16) * 100);
  assert.equal(model.days[2].columns[1].blocks.length, 0);
});

test("the window grows so a booking outside it is not hidden", () => {
  const model = grid([record("a", "10", at(7, 4, 30), at(7, 5, 30)), record("b", "11", at(7, 21), at(7, 23, 15))]);
  assert.equal(model.hourFrom, 4);
  assert.equal(model.hourTo, 24);
  const [early] = model.days[2].columns[0].blocks;
  assert.equal(early.top, (0.5 / 20) * 100);
});

test("a booking that spans midnight is drawn on both days with its real times", () => {
  const model = grid([record("a", "10", at(7, 22), at(8, 2))]);
  const first = model.days[2].columns[0].blocks[0];
  const second = model.days[3].columns[0].blocks[0];
  assert.equal(first.start, at(7, 22));
  assert.equal(first.end, at(8, 0));
  assert.equal(second.start, at(8, 0));
  assert.equal(second.end, at(8, 2));
  assert.equal(first.rawStart, at(7, 22));
  assert.equal(second.rawEnd, at(8, 2));
  assert.equal(model.hourFrom, 0);
  assert.equal(model.hourTo, 24);
});

test("bookings outside the week or of other resources are ignored", () => {
  const model = grid([
    record("a", "10", at(3, 10), at(3, 12)),
    record("b", "10", at(12, 10), at(12, 12)),
    record("c", "99", at(7, 10), at(7, 12)),
  ]);
  for (const day of model.days) {
    for (const column of day.columns) assert.equal(column.blocks.length, 0);
  }
});

test("a linked booking appears on every resource it blocks", () => {
  const model = grid([
    record("a", "10", at(7, 10), at(7, 12)),
    record("a", "11", at(7, 10), at(7, 12), { linked: true }),
    record("a", "11", at(7, 10), at(7, 12), { linked: true }),
  ]);
  const [cnc, laser] = model.days[2].columns;
  assert.equal(cnc.blocks.length, 1);
  assert.equal(laser.blocks.length, 1);
  assert.equal(laser.blocks[0].linked, true);
  assert.equal(cnc.blocks[0].linked, false);
});

test("own bookings are recognised by id, member and time", () => {
  const records = [
    record("1", "10", at(7, 9), at(7, 10)),
    record("2", "10", at(7, 11), at(7, 12), { coworkerId: "55" }),
    record("3", "10", at(7, 13), at(7, 14), { coworkerName: "Ada Lovelace" }),
    record("4", "11", at(7, 15), at(7, 16)),
    record("5", "11", at(7, 17), at(7, 18)),
  ];
  const model = grid(records, {
    mine: [{ id: "1", resourceId: "10", start: at(7, 9), end: at(7, 10) }, { id: "9", resourceId: "11", start: at(7, 15), end: at(7, 16) }],
    me: { id: "55", name: "Ada Lovelace" },
  });
  const [cnc, laser] = model.days[2].columns;
  assert.deepEqual(plain(cnc.blocks.map((block) => block.mine)), [true, true, true]);
  assert.deepEqual(plain(laser.blocks.map((block) => block.mine)), [true, false]);
});

test("a record naming another member is not claimed by an overlapping own booking", () => {
  const model = grid(
    [record("1", "10", at(7, 9), at(7, 11), { coworkerId: "77", coworkerName: "Sam" })],
    {
      mine: [{ id: "9", resourceId: "10", start: at(7, 8), end: at(7, 10) }],
      me: { id: "55", name: "Ada" },
    },
  );
  assert.equal(model.days[2].columns[0].blocks[0].mine, false);
});

test("Luma events become bands on every day they touch", () => {
  const model = grid([], {
    events: [{ start: at(7, 18), end: at(8, 1), name: "Open evening" }],
  });
  const first = model.days[2].events[0];
  assert.equal(first.name, "Open evening");
  assert.equal(first.top, (12 / 16) * 100);
  assert.equal(first.height, (4 / 16) * 100);
  assert.equal(model.days[3].events.length, 0);
});

test("slotAt snaps down, reports the free minutes and refuses occupied or past slots", () => {
  const model = grid([record("a", "10", at(7, 14), at(7, 15)), record("b", "10", at(7, 9), at(7, 10))]);
  const column = model.days[2].columns[0];

  const free = W.slotAt(column, at(7, 12, 20), { now: NOW, snapMinutes: 15 });
  assert.equal(free.start, at(7, 12, 15));
  assert.equal(free.occupied, null);
  assert.equal(free.gapMinutes, 105);
  assert.equal(free.past, false);

  const busy = W.slotAt(column, at(7, 14, 30), { now: NOW });
  assert.equal(busy.occupied.id, "a");

  const past = W.slotAt(column, at(7, 11, 0), { now: NOW });
  assert.equal(past.past, true);

  const last = W.slotAt(column, at(7, 16, 0), { now: NOW });
  assert.equal(last.gapMinutes, 8 * 60);
});

test("capacity lanes leave remaining units bookable beside a partial booking", () => {
  const resources = [{ id: "10", name: "MK4S", allocation: 3 }];
  const model = W.weekGrid(
    [
      record("1", "10", at(7, 13), at(7, 15), { coworkerId: "77", coworkerName: "Florian" }),
      record("2", "10", at(7, 13), at(7, 15), { coworkerId: "77", coworkerName: "Florian" }),
    ],
    resources,
    { weekStart: WEEK, now: NOW },
  );
  const column = model.days[2].columns[0];
  const [block] = column.blocks;

  assert.equal(column.capacity, 3);
  assert.equal(block.count, 2);
  assert.equal(block.lane, 0);
  assert.equal(block.unitCount, 2);
  assert.equal(block.lanes, 3);
  assert.equal(column.visibleLanes, 3);

  const free = W.slotAt(column, at(7, 13, 30), { now: NOW });
  assert.equal(free.occupied, null);
  assert.equal(free.availableUnits, 1);
  assert.equal(free.gapMinutes, 10 * 60 + 30);

  const full = W.weekGrid(
    [
      ...[
        record("1", "10", at(7, 13), at(7, 15), { coworkerId: "77", coworkerName: "Florian" }),
        record("2", "10", at(7, 13), at(7, 15), { coworkerId: "77", coworkerName: "Florian" }),
      ],
      record("3", "10", at(7, 14), at(7, 16), { coworkerId: "88", coworkerName: "Sam" }),
    ],
    resources,
    { weekStart: WEEK, now: NOW },
  );
  const fullColumn = full.days[2].columns[0];
  const partlyAvailable = W.slotAt(fullColumn, at(7, 13, 30), { now: NOW });
  assert.equal(partlyAvailable.occupied, null);
  assert.equal(partlyAvailable.availableUnits, 1);
  assert.equal(partlyAvailable.gapMinutes, 30);

  const unavailable = W.slotAt(fullColumn, at(7, 14, 15), { now: NOW });
  assert.ok(unavailable.occupied);
  assert.equal(unavailable.availableUnits, 0);
  assert.equal(fullColumn.blocks[1].lane, 2);
  assert.equal(fullColumn.blocks[1].lanes, 3);
});

test("visible capacity lanes are compact per day and preserve over-capacity bookings", () => {
  const resources = [{ id: "10", name: "MK4S", allocation: 4 }];
  const records = [
    record("1", "10", at(7, 9), at(7, 12)),
    record("2", "10", at(7, 10), at(7, 11)),
    record("3", "10", at(8, 9), at(8, 12), { coworkerId: "77", coworkerName: "Florian" }),
    record("4", "10", at(8, 9), at(8, 12), { coworkerId: "77", coworkerName: "Florian" }),
    record("5", "10", at(8, 10), at(8, 11)),
    record("6", "10", at(10, 9), at(10, 12)),
    record("7", "10", at(10, 9), at(10, 12)),
    record("8", "10", at(10, 9), at(10, 12)),
    record("9", "10", at(10, 9), at(10, 12)),
    record("10", "10", at(11, 9), at(11, 12)),
    record("11", "10", at(11, 9), at(11, 12)),
    record("12", "10", at(11, 9), at(11, 12)),
    record("13", "10", at(11, 9), at(11, 12)),
    record("14", "10", at(11, 9), at(11, 12)),
  ];
  const model = W.weekGrid(records, resources, {
    weekStart: WEEK,
    now: NOW,
    reserved: [{ resourceId: "10", start: at(9, 9), end: at(9, 12), name: "Workshop" }],
  });
  const columns = model.days.map((day) => day.columns[0]);

  assert.deepEqual(plain(columns.map((column) => column.visibleLanes)), [1, 1, 3, 4, 2, 4, 5]);
  assert.equal(columns[2].blocks.every((block) => block.lanes === 3), true);
  assert.equal(columns[3].blocks.every((block) => block.lanes === 4), true);
  assert.equal(columns[4].blocks[0].reserved, true);

  const partlyAvailable = W.slotAt(columns[2], at(7, 10, 15), { now: NOW });
  assert.equal(partlyAvailable.capacity, 4);
  assert.equal(partlyAvailable.availableUnits, 2);
  assert.equal(partlyAvailable.occupied, null);
  const full = W.slotAt(columns[5], at(10, 10, 15), { now: NOW });
  assert.equal(full.capacity, 4);
  assert.equal(full.availableUnits, 0);
  assert.ok(full.occupied);
});

test("workshop reservations block their machine and are flagged", () => {
  const model = grid([], {
    reserved: [
      { resourceId: "11", start: at(7, 13), end: at(7, 15), name: "Workshop" },
      { resourceId: "99", start: at(7, 13), end: at(7, 15), name: "Elsewhere" },
    ],
  });
  const [cnc, laser] = model.days[2].columns;
  assert.equal(cnc.blocks.length, 0);
  assert.equal(laser.blocks.length, 1);
  assert.equal(laser.blocks[0].reserved, true);
  assert.equal(laser.blocks[0].name, "Workshop");
  assert.equal(W.slotAt(laser, at(7, 14), { now: NOW }).occupied.reserved, true);
});

test("reservations on a linked resource block its columns too", () => {
  const model = grid([], {
    reserved: [{ resourceId: "99", start: at(7, 13), end: at(7, 15), name: "Event" }],
    links: new Map([["99", new Set(["11"])]]),
  });
  const [cnc, laser] = model.days[2].columns;
  assert.equal(cnc.blocks.length, 0);
  assert.equal(laser.blocks.length, 1);
  assert.equal(laser.blocks[0].reserved, true);
  assert.equal(laser.blocks[0].linked, true);
  assert.equal(laser.blocks[0].name, "Event");
  assert.equal(W.slotAt(laser, at(7, 14), { now: NOW }).occupied.reserved, true);
});

test("a feed copy on the linked column is not drawn twice", () => {
  const model = grid([], {
    reserved: [
      { resourceId: "99", start: at(7, 13), end: at(7, 15), name: "Event" },
      { resourceId: "11", start: at(7, 13), end: at(7, 15), name: "Event" },
    ],
    links: new Map([
      ["99", new Set(["11"])],
      ["11", new Set(["99"])],
    ]),
  });
  const laser = model.days[2].columns[1];
  assert.equal(laser.blocks.length, 1);
});

test("overlapping blocks in one column get side-by-side lanes", () => {
  const model = grid([
    record("a", "10", at(7, 8), at(7, 10)),
    record("b", "10", at(7, 9), at(7, 11)),
    record("c", "10", at(7, 13), at(7, 14)),
  ]);
  const blocks = model.days[2].columns[0].blocks;
  assert.deepEqual(plain(blocks.map((block) => [block.lane, block.lanes])), [[0, 2], [1, 2], [0, 2]]);
});

test("ownedResourceIds lists the machines the member has booked", () => {
  const records = [
    record("1", "10", at(7, 9), at(7, 10), { coworkerId: "55" }),
    record("2", "11", at(7, 9), at(7, 10)),
  ];
  assert.deepEqual([...plain([...W.ownedResourceIds(records, { me: { id: "55", name: "" } })])], ["10"]);
  assert.deepEqual(
    plain([...W.ownedResourceIds(records, { mine: [{ id: "7", resourceId: "11", start: at(9, 9), end: at(9, 10) }] })]),
    ["11"],
  );
});

test("identical bookings of one member in one slot are drawn once with a count", () => {
  const model = grid([
    record("1", "10", at(7, 13), at(7, 22), { coworkerId: "77", coworkerName: "Florian" }),
    record("2", "10", at(7, 13), at(7, 22), { coworkerId: "77", coworkerName: "Florian" }),
    record("3", "10", at(7, 13), at(7, 22), { coworkerId: "88", coworkerName: "Sam" }),
    record("4", "11", at(7, 13), at(7, 22), { coworkerId: "77", coworkerName: "Florian" }),
    record("5", "10", at(7, 9), at(7, 10)),
    record("6", "10", at(7, 9), at(7, 10)),
  ]);
  const [cnc, laser] = model.days[2].columns;
  assert.deepEqual(plain(cnc.blocks.map((block) => [block.id, block.count || 1])), [
    ["5", 1],
    ["6", 1],
    ["1", 2],
    ["3", 1],
  ]);
  assert.equal(laser.blocks.length, 1);
});

test("weekTitle names the first and last day", () => {
  assert.equal(W.weekTitle(new Date(2026, 0, 5)), "5 Jan – 11 Jan");
});
