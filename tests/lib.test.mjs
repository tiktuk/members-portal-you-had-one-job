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
  const { OneJobUrl } = loadLibs();
  assert.deepEqual(plain(OneJobUrl.parseBookingPath("/motionlabberlin/bookings/machines/list")), {
    webAddress: "motionlabberlin",
    type: "machines",
    view: "list",
  });
  assert.equal(OneJobUrl.parseBookingPath("/motionlabberlin/bookings/labs/calendar").view, "calendar");
  assert.equal(OneJobUrl.parseBookingPath("/motionlabberlin/bookings/all/floorplan").type, "all");
  assert.equal(OneJobUrl.parseBookingPath("/motionlabberlin/community"), null);
  assert.equal(OneJobUrl.parseBookingPath("/motionlabberlin/bookings/machines"), null);
});

test("pathWithView only rewrites actual bookings views", () => {
  const { OneJobUrl } = loadLibs();
  assert.equal(
    OneJobUrl.pathWithView("/motionlabberlin/bookings/machines/list", "calendar"),
    "/motionlabberlin/bookings/machines/calendar",
  );
  assert.equal(OneJobUrl.pathWithView("/motionlabberlin/bookings/machines/calendar", "calendar"), null);
  assert.equal(OneJobUrl.pathWithView("/motionlabberlin/bookings", "calendar"), null);
  assert.equal(OneJobUrl.pathWithView("/motionlabberlin/store", "calendar"), null);
});

test("toCalendarUrl keeps the query string untouched", () => {
  const { OneJobUrl } = loadLibs();
  const rewritten = OneJobUrl.toCalendarUrl(PAGE);
  assert.equal(
    rewritten,
    "/motionlabberlin/bookings/machines/calendar?group=Machines%3A+CNC+Machining&start=2026-10-26T21%3A45%3A00.000%2B01%3A00",
  );
});

test("toCalendarUrl handles relative and absolute same-origin URLs", () => {
  const { OneJobUrl } = loadLibs();
  assert.equal(
    OneJobUrl.toCalendarUrl("/motionlabberlin/bookings/labs/list"),
    "/motionlabberlin/bookings/labs/calendar",
  );
  assert.equal(
    OneJobUrl.toCalendarUrl(`${ORIGIN}/motionlabberlin/bookings/labs/list`),
    "/motionlabberlin/bookings/labs/calendar",
  );
  assert.equal(OneJobUrl.toCalendarUrl("https://example.com/motionlabberlin/bookings/labs/list"), null);
  assert.equal(OneJobUrl.toCalendarUrl("/motionlabberlin/bookings/labs/calendar"), null);
});

test("bookingHref encodes group names the way the portal expects", () => {
  const { OneJobUrl } = loadLibs();
  assert.equal(
    OneJobUrl.bookingHref({
      webAddress: "motionlabberlin",
      type: "labs",
      view: "calendar",
      group: "Labs: Outdoor Lab",
    }),
    "/motionlabberlin/bookings/labs/calendar?group=Labs%3A+Outdoor+Lab",
  );
  assert.equal(
    OneJobUrl.bookingHref({ webAddress: "motionlabberlin", type: "machines", view: "calendar" }),
    "/motionlabberlin/bookings/machines/calendar",
  );
});

test("bookingHref can pin a single resource", () => {
  const { OneJobUrl } = loadLibs();
  assert.equal(
    OneJobUrl.bookingHref({
      webAddress: "motionlabberlin",
      type: "machines",
      view: "calendar",
      group: "Machines: CNC Machining ",
      resource: 1415309496,
    }),
    "/motionlabberlin/bookings/machines/calendar?group=Machines%3A+CNC+Machining+&onejob-resource=1415309496",
  );
  assert.equal(OneJobUrl.RESOURCE_PARAM, "onejob-resource");
  assert.equal(OneJobUrl.currentPinnedResource("?onejob-resource=1415309496"), "1415309496");
  assert.equal(OneJobUrl.currentPinnedResource(""), "");
});

test("currentRange/currentGroup read the active query", () => {
  const { OneJobUrl } = loadLibs();
  assert.deepEqual(plain(OneJobUrl.currentRange("?start=2026-10-26T21%3A45%3A00.000%2B01%3A00&end=2026-10-26T22%3A45%3A00.000%2B01%3A00")), {
    start: "2026-10-26T21:45:00.000+01:00",
    end: "2026-10-26T22:45:00.000+01:00",
  });
  assert.equal(OneJobUrl.currentGroup("?group=Labs%3A+Outdoor+Lab"), "Labs: Outdoor Lab");
  assert.equal(OneJobUrl.currentGroup(""), "");
});

test("the explicit list choice is remembered for the tab", () => {
  const { OneJobUrl } = loadLibs();
  assert.equal(OneJobUrl.isListAllowed(), false);
  OneJobUrl.setListAllowed(true);
  assert.equal(OneJobUrl.isListAllowed(), true);
  OneJobUrl.setListAllowed(false);
  assert.equal(OneJobUrl.isListAllowed(), false);
});

const PAYLOAD = {
  Resources: [
    { Id: 1415309496, Name: "OLSK Large CNC ", SystemResourceType: 10, GroupName: "Machines: CNC Machining" },
    { Id: 1415309596, Name: "CNC Routermax 1325 Deluxe", SystemResourceType: 10, GroupName: "Machines: CNC Machining" },
    { Id: 1415309571, Name: "Prusa - MK4", SystemResourceType: 10, GroupName: "Machines: 3D printing" },
    { Id: 1415309502, Name: "Outdoor Lab", SystemResourceType: 5, GroupName: "Labs: Outdoor Lab " },
    { Id: 1415299774, Name: "Meeting Room: BUS", SystemResourceType: 1, GroupName: "Meeting Rooms" },
    { Id: 1415299775, Name: "No group", SystemResourceType: 1, GroupName: "" },
    { Id: 1415309999, Name: "Unmapped", SystemResourceType: 99, GroupName: "Unmapped" },
  ],
};

test("groupsBySlugFromPayload groups, preserves exact names and de-duplicates", () => {
  const { OneJobGroups } = loadLibs();
  assert.deepEqual(plain(OneJobGroups.groupsBySlugFromPayload(PAYLOAD)), {
    machines: ["Machines: 3D printing", "Machines: CNC Machining"],
    labs: ["Labs: Outdoor Lab "],
    "meeting-rooms": ["Meeting Rooms"],
    "other-resources": ["Unmapped"],
  });
});

test("resourceListFromPayload exposes individual resources", () => {
  const { OneJobGroups } = loadLibs();
  const resources = plain(OneJobGroups.resourceListFromPayload(PAYLOAD));
  assert.deepEqual(
    resources.map((resource) => resource.id),
    ["1415309496", "1415309596", "1415309571", "1415309502", "1415299774", "1415299775", "1415309999"],
  );
  assert.equal(resources[0].name, "OLSK Large CNC");
  // The raw group is kept for the portal's exact match filter.
  assert.equal(resources[3].group, "Labs: Outdoor Lab ");
  assert.equal(resources[0].type, "machines");
  assert.equal(resources[4].type, "meeting-rooms");
});

test("buildMenuModel keeps the portal's type order and strips prefixes", () => {
  const { OneJobGroups } = loadLibs();
  const groups = OneJobGroups.groupsBySlugFromPayload(PAYLOAD);
  const model = OneJobGroups.buildMenuModel(
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
  const { OneJobGroups } = loadLibs();
  const groups = OneJobGroups.groupsBySlugFromPayload(PAYLOAD);
  const model = OneJobGroups.buildMenuModel(groups, [{ slug: "hot-desks", label: "Hot desks" }], {
    stripPrefix: false,
    hideEmptyTypes: false,
  });
  const hotDesks = model.find((type) => type.slug === "hot-desks");
  assert.deepEqual(plain(hotDesks.groups), []);
  assert.equal(model.find((type) => type.slug === "labs").groups[0].label, "Labs: Outdoor Lab");
});

test("unknown resource types are skipped", () => {
  const { OneJobGroups } = loadLibs();
  assert.equal(OneJobGroups.slugForType(1234), null);
  assert.equal(OneJobGroups.slugForType("10"), "machines");
});

test("apiBaseUrl targets the space's own Nexudus subdomain", () => {
  const { OneJobUrl } = loadLibs();
  assert.equal(OneJobUrl.apiBaseUrl("motionlabberlin"), "https://motionlabberlin.spaces.nexudus.com");
  assert.equal(OneJobUrl.apiBaseUrl(), "https://motionlabberlin.spaces.nexudus.com");
});
