import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

const ORIGIN = "https://members.motionlab.berlin";
const PAGE = `${ORIGIN}/motionlabberlin/bookings/machines/list?group=Machines%3A+CNC+Machining&start=2026-10-26T21%3A45%3A00.000%2B01%3A00`;

function makeSessionStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

/** Values created inside the vm context use a different realm's prototypes. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadLibs(href = PAGE) {
  const context = vm.createContext({
    URL,
    URLSearchParams,
    console,
    location: new URL(href),
    sessionStorage: makeSessionStorage(),
  });
  for (const file of ["lib/config.js", "lib/url.js", "lib/groups.js"]) {
    vm.runInContext(readFileSync(join(src, file), "utf8"), context, { filename: file });
  }
  return context;
}

test("parseBookingPath understands bookings routes", () => {
  const { NXPlusUrl } = loadLibs();
  assert.deepEqual(plain(NXPlusUrl.parseBookingPath("/motionlabberlin/bookings/machines/list")), {
    webAddress: "motionlabberlin",
    type: "machines",
    view: "list",
  });
  assert.equal(NXPlusUrl.parseBookingPath("/motionlabberlin/bookings/labs/calendar").view, "calendar");
  assert.equal(NXPlusUrl.parseBookingPath("/motionlabberlin/bookings/all/floorplan").type, "all");
  assert.equal(NXPlusUrl.parseBookingPath("/motionlabberlin/community"), null);
  assert.equal(NXPlusUrl.parseBookingPath("/motionlabberlin/bookings/machines"), null);
});

test("pathWithView only rewrites actual bookings views", () => {
  const { NXPlusUrl } = loadLibs();
  assert.equal(
    NXPlusUrl.pathWithView("/motionlabberlin/bookings/machines/list", "calendar"),
    "/motionlabberlin/bookings/machines/calendar",
  );
  assert.equal(NXPlusUrl.pathWithView("/motionlabberlin/bookings/machines/calendar", "calendar"), null);
  assert.equal(NXPlusUrl.pathWithView("/motionlabberlin/bookings", "calendar"), null);
  assert.equal(NXPlusUrl.pathWithView("/motionlabberlin/store", "calendar"), null);
});

test("toCalendarUrl keeps the query string untouched", () => {
  const { NXPlusUrl } = loadLibs();
  const rewritten = NXPlusUrl.toCalendarUrl(PAGE);
  assert.equal(
    rewritten,
    "/motionlabberlin/bookings/machines/calendar?group=Machines%3A+CNC+Machining&start=2026-10-26T21%3A45%3A00.000%2B01%3A00",
  );
});

test("toCalendarUrl handles relative and absolute same-origin URLs", () => {
  const { NXPlusUrl } = loadLibs();
  assert.equal(
    NXPlusUrl.toCalendarUrl("/motionlabberlin/bookings/labs/list"),
    "/motionlabberlin/bookings/labs/calendar",
  );
  assert.equal(
    NXPlusUrl.toCalendarUrl(`${ORIGIN}/motionlabberlin/bookings/labs/list`),
    "/motionlabberlin/bookings/labs/calendar",
  );
  assert.equal(NXPlusUrl.toCalendarUrl("https://example.com/motionlabberlin/bookings/labs/list"), null);
  assert.equal(NXPlusUrl.toCalendarUrl("/motionlabberlin/bookings/labs/calendar"), null);
});

test("bookingHref encodes group names the way the portal expects", () => {
  const { NXPlusUrl } = loadLibs();
  assert.equal(
    NXPlusUrl.bookingHref({
      webAddress: "motionlabberlin",
      type: "labs",
      view: "calendar",
      group: "Labs: Outdoor Lab",
    }),
    "/motionlabberlin/bookings/labs/calendar?group=Labs%3A+Outdoor+Lab",
  );
  assert.equal(
    NXPlusUrl.bookingHref({ webAddress: "motionlabberlin", type: "machines", view: "calendar" }),
    "/motionlabberlin/bookings/machines/calendar",
  );
});

test("currentRange/currentGroup read the active query", () => {
  const { NXPlusUrl } = loadLibs();
  assert.deepEqual(plain(NXPlusUrl.currentRange("?start=2026-10-26T21%3A45%3A00.000%2B01%3A00&end=2026-10-26T22%3A45%3A00.000%2B01%3A00")), {
    start: "2026-10-26T21:45:00.000+01:00",
    end: "2026-10-26T22:45:00.000+01:00",
  });
  assert.equal(NXPlusUrl.currentGroup("?group=Labs%3A+Outdoor+Lab"), "Labs: Outdoor Lab");
  assert.equal(NXPlusUrl.currentGroup(""), "");
});

test("the explicit list choice is remembered for the tab", () => {
  const { NXPlusUrl } = loadLibs();
  assert.equal(NXPlusUrl.isListAllowed(), false);
  NXPlusUrl.setListAllowed(true);
  assert.equal(NXPlusUrl.isListAllowed(), true);
  NXPlusUrl.setListAllowed(false);
  assert.equal(NXPlusUrl.isListAllowed(), false);
});

const PAYLOAD = {
  Resources: [
    { SystemResourceType: 10, GroupName: "Machines: CNC Machining" },
    { SystemResourceType: 10, GroupName: "Machines: 3D printing" },
    { SystemResourceType: 10, GroupName: "Machines: CNC Machining" },
    { SystemResourceType: 5, GroupName: "Labs: Outdoor Lab " },
    { SystemResourceType: 1, GroupName: "Meeting Rooms" },
    { SystemResourceType: 1, GroupName: "" },
    { SystemResourceType: 99, GroupName: "Unmapped" },
  ],
};

test("groupsBySlugFromPayload groups, preserves exact names and de-duplicates", () => {
  const { NXPlusGroups } = loadLibs();
  assert.deepEqual(plain(NXPlusGroups.groupsBySlugFromPayload(PAYLOAD)), {
    machines: ["Machines: 3D printing", "Machines: CNC Machining"],
    labs: ["Labs: Outdoor Lab "],
    "meeting-rooms": ["Meeting Rooms"],
    "other-resources": ["Unmapped"],
  });
});

test("buildMenuModel keeps the portal's type order and strips prefixes", () => {
  const { NXPlusGroups } = loadLibs();
  const groups = NXPlusGroups.groupsBySlugFromPayload(PAYLOAD);
  const model = NXPlusGroups.buildMenuModel(
    groups,
    [
      { slug: "meeting-rooms", label: "Meeting rooms" },
      { slug: "labs", label: "Labs" },
      { slug: "machines", label: "Machines" },
    ],
    { stripPrefix: true, hideEmptyTypes: true },
  );

  assert.deepEqual(
    plain(model.map((type) => type.slug)),
    ["machines", "labs", "meeting-rooms", "other-resources"],
  );
  assert.deepEqual(
    plain(model.find((type) => type.slug === "machines").groups.map((group) => group.label)),
    ["3D printing", "CNC Machining"],
  );
  // The raw name keeps the trailing space so the portal's exact filter matches.
  assert.equal(model.find((type) => type.slug === "labs").groups[0].name, "Labs: Outdoor Lab ");
  assert.equal(model.find((type) => type.slug === "labs").groups[0].label, "Outdoor Lab");
});

test("buildMenuModel can keep prefixes and empty types", () => {
  const { NXPlusGroups } = loadLibs();
  const groups = NXPlusGroups.groupsBySlugFromPayload(PAYLOAD);
  const model = NXPlusGroups.buildMenuModel(groups, [{ slug: "hot-desks", label: "Hot desks" }], {
    stripPrefix: false,
    hideEmptyTypes: false,
  });
  const hotDesks = model.find((type) => type.slug === "hot-desks");
  assert.deepEqual(plain(hotDesks.groups), []);
  assert.equal(model.find((type) => type.slug === "labs").groups[0].label, "Labs: Outdoor Lab");
});

test("unknown resource types are skipped", () => {
  const { NXPlusGroups } = loadLibs();
  assert.equal(NXPlusGroups.slugForType(1234), null);
  assert.equal(NXPlusGroups.slugForType("10"), "machines");
});

test("apiBaseUrl targets the space's own Nexudus subdomain", () => {
  const { NXPlusUrl } = loadLibs();
  assert.equal(NXPlusUrl.apiBaseUrl("motionlabberlin"), "https://motionlabberlin.spaces.nexudus.com");
  assert.equal(NXPlusUrl.apiBaseUrl(), "https://motionlabberlin.spaces.nexudus.com");
});
