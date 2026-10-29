import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = join(root, "src");

const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));

test("manifest is a valid MV3 web extension manifest", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.name);
  assert.ok(manifest.version);
  assert.deepEqual(manifest.permissions, ["storage"]);
});

test("every file referenced by the manifest exists", () => {
  const referenced = new Set();
  referenced.add(manifest.action.default_popup);
  referenced.add(manifest.background.service_worker);
  Object.values(manifest.action.default_icon).forEach((file) => referenced.add(file));
  Object.values(manifest.icons).forEach((file) => referenced.add(file));
  manifest.content_scripts.forEach((entry) => {
    entry.js.forEach((file) => referenced.add(file));
    (entry.css || []).forEach((file) => referenced.add(file));
  });
  manifest.web_accessible_resources.forEach((entry) => {
    entry.resources.forEach((file) => referenced.add(file));
  });

  for (const file of referenced) {
    assert.ok(existsSync(join(src, file)), `missing ${file}`);
  }
});

test("page-world scripts are web accessible to the portal", () => {
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources);
  for (const file of ["lib/config.js", "lib/url.js", "page.js"]) {
    assert.ok(resources.includes(file), `${file} must be web accessible`);
  }
  const matches = manifest.web_accessible_resources.flatMap((entry) => entry.matches);
  assert.ok(matches.includes("https://members.motionlab.berlin/*"));
});

test("the pinned overview page can be opened from the portal", () => {
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources);
  assert.ok(resources.includes("overview.html"));
});

test("popup links to the pinned overview", () => {
  const html = readFileSync(join(src, "popup.html"), "utf8");
  assert.match(html, /id="overview-link"[^>]*href="overview\.html"/);
});

test("content script loads shared libraries before itself", () => {
  const [entry] = manifest.content_scripts;
  assert.deepEqual(entry.js, [
    "lib/config.js",
    "lib/url.js",
    "lib/groups.js",
    "lib/overview.js",
    "lib/overview-view.js",
    "content.js",
  ]);
  assert.equal(entry.run_at, "document_start");
});

test("the overview stylesheet is web accessible to the shadow root", () => {
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources);
  assert.ok(resources.includes("overview.css"));
});

test("popup loads the shared config", () => {
  const html = readFileSync(join(src, "popup.html"), "utf8");
  assert.match(html, /<script src="lib\/config\.js"><\/script>/);
  assert.match(html, /<script src="popup\.js"><\/script>/);
});

test("the background worker can reach the Luma API", () => {
  assert.equal(manifest.background.service_worker, "background.js");
  assert.ok(manifest.host_permissions.includes("https://api.luma.com/*"));
});

test("popup exposes the Luma events toggle", () => {
  const html = readFileSync(join(src, "popup.html"), "utf8");
  assert.match(html, /id="luma-events"/);
});
