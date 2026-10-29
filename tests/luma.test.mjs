import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

function loadLuma() {
  const context = vm.createContext({ console, URLSearchParams });
  vm.runInContext(readFileSync(join(src, "lib/luma.js"), "utf8"), context, {
    filename: "lib/luma.js",
  });
  return context.NXPlusLuma;
}

test("parseSource accepts API IDs and public luma.com URLs", () => {
  const L = loadLuma();

  assert.deepEqual(
    { ...L.parseSource("usr-csfrCNKvDVPwE0L") },
    { kind: "user", id: "usr-csfrCNKvDVPwE0L" },
  );
  assert.deepEqual(
    { ...L.parseSource("https://luma.com/user/usr-csfrCNKvDVPwE0L") },
    { kind: "user", id: "usr-csfrCNKvDVPwE0L" },
  );
  assert.deepEqual(
    { ...L.parseSource("cal-KAzEnMO7UTGkxZ1") },
    { kind: "calendar", id: "cal-KAzEnMO7UTGkxZ1" },
  );
  assert.deepEqual(
    { ...L.parseSource("https://lu.ma/cal-abc123") },
    { kind: "calendar", id: "cal-abc123" },
  );
  assert.equal(L.parseSource("https://luma.com/event/xyz"), null);
  assert.equal(L.parseSource(""), null);
});

test("listUrl mirrors the web app's public endpoints", () => {
  const L = loadLuma();
  const user = L.listUrl("https://api.luma.com", { kind: "user", id: "usr-abc" }, { limit: 50 });
  assert.match(user, /^https:\/\/api\.luma\.com\/user\/profile\/events-hosting\?/);
  assert.match(user, /user_api_id=usr-abc/);
  assert.match(user, /period=future/);
  assert.match(user, /pagination_limit=50/);

  const calendar = L.listUrl(
    "https://api.luma.com/",
    { kind: "calendar", id: "cal-abc" },
    { limit: 50, cursor: "next page" },
  );
  assert.match(calendar, /^https:\/\/api\.luma\.com\/calendar\/get-items\?/);
  assert.match(calendar, /calendar_api_id=cal-abc/);
  assert.match(calendar, /pagination_cursor=next\+page/);
});

test("eventUrl points at the single-event endpoint", () => {
  const L = loadLuma();
  assert.equal(
    L.eventUrl("https://api.luma.com", "evt-C3JKZHB8Ar2HxQe"),
    "https://api.luma.com/event/get?event_api_id=evt-C3JKZHB8Ar2HxQe",
  );
});

test("flattenDescription mirrors the web app's rich-text flattener", () => {
  const L = loadLuma();
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Kickstart your morning." },
          { type: "hard_break" },
          { type: "text", text: "Coffee and pastries." },
        ],
      },
      {
        type: "bullet_list",
        content: [
          { type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "Talks" }] }] },
          { type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "Demos" }] }] },
        ],
      },
    ],
  };

  const text = L.normalizeDescription(L.flattenDescription(doc));
  assert.equal(text, "Kickstart your morning.\nCoffee and pastries.\n\n• Talks\n• Demos");
});

test("normalizeDescription trims trailing spaces and repeated blank lines", () => {
  const L = loadLuma();
  assert.equal(L.normalizeDescription("  one  \n\n\n\ntwo\n"), "one\n\ntwo");
});
