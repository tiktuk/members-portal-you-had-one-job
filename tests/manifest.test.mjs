import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = join(root, "src");

const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));

/** lib/config.js, which must not need `chrome` at load time. */
function loadConfig() {
  const context = vm.createContext({ URL, URLSearchParams, console });
  vm.runInContext(readFileSync(join(src, "lib/config.js"), "utf8"), context, {
    filename: "lib/config.js",
  });
  return context.OneJobConfig;
}

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

test("page-world scripts are web accessible to the built-in portal only", () => {
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources);
  for (const file of ["lib/config.js", "lib/url.js", "page.js"]) {
    assert.ok(resources.includes(file), `${file} must be web accessible`);
  }
  const matches = manifest.web_accessible_resources.flatMap((entry) => entry.matches);
  assert.deepEqual(matches, ["https://members.motionlab.berlin/*"]);
});

test("the built-in portal runs without a permission prompt", () => {
  const cfg = loadConfig();
  const matches = manifest.content_scripts.flatMap((entry) => entry.matches);
  assert.deepEqual(matches, [`${cfg.portal.origin}/*`]);
});

test("the manifest asks for the narrowest host access that works", () => {
  const cfg = loadConfig();
  const webAddress = cfg.portal.webAddress;
  assert.deepEqual(manifest.host_permissions, [
    `https://${webAddress}.spaces.nexudus.com/*`,
    "https://api.luma.com/*",
  ]);
  // Every wildcard host and the runtime-registration permission went away with
  // the multi-portal feature; see the runtime-portals branch to bring it back.
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.ok(!manifest.permissions.includes("scripting"));
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

test("the version matches the package and the newest changelog entry", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(manifest.version, pkg.version);

  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  assert.match(changelog, /^## \[Unreleased\]$/m);
  const releases = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/gm)];
  assert.ok(releases.length > 0, "CHANGELOG.md needs a released version");
  assert.equal(
    releases[0][1],
    manifest.version,
    "the newest changelog entry must match the manifest version",
  );
});

test("popup exposes the Luma events toggle", () => {
  const html = readFileSync(join(src, "popup.html"), "utf8");
  assert.match(html, /id="luma-events"/);
});
