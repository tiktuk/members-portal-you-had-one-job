import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

const html = readFileSync(join(src, "popup.html"), "utf8");
const script = readFileSync(join(src, "popup.js"), "utf8");

function loadConfig() {
  const context = vm.createContext({ console });
  vm.runInContext(readFileSync(join(src, "lib", "config.js"), "utf8"), context, {
    filename: "lib/config.js",
  });
  return context.OneJobConfig;
}

test("every element the popup script looks up exists in the markup", () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const wanted = [...script.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);

  assert.ok(wanted.length > 0, "popup.js should look elements up by id");
  for (const id of wanted) assert.ok(ids.has(id), `popup.html has no #${id}`);
});

test("the popup is only the toggles and the pin list", () => {
  assert.doesNotMatch(html, /portal-form|portal-input/);
  assert.match(html, /<script src="lib\/config\.js"><\/script>\s*<script src="popup\.js"><\/script>/);
});

test("the two event rows are named by the view they affect", () => {
  assert.match(html, /id="luma-events"/);
  assert.match(html, /Luma events in overview/);
  assert.match(html, /id="day-grid-events"/);
  assert.match(html, /Luma events in heatmap/);
});

test("the overview header has no events toggle", () => {
  const view = readFileSync(join(src, "lib", "overview-view.js"), "utf8");
  assert.doesNotMatch(view, /button-toggle/);
  assert.doesNotMatch(view, /lumaToggle|lumaInput/);
});

test("the tour's settings preview names the popup's rows", () => {
  const rows = loadConfig().onboarding.settings;
  assert.ok(rows.length > 0, "config.onboarding.settings should list the rows");
  for (const row of rows) {
    assert.ok(html.includes(row.label), `popup.html has no “${row.label}” row`);
  }
});
