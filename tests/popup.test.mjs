import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

const html = readFileSync(join(src, "popup.html"), "utf8");
const script = readFileSync(join(src, "popup.js"), "utf8");

test("every element the popup script looks up exists in the markup", () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const wanted = [...script.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);

  assert.ok(wanted.length > 0, "popup.js should look elements up by id");
  for (const id of wanted) assert.ok(ids.has(id), `popup.html has no #${id}`);
});

test("the popup can register other portals", () => {
  assert.match(html, /id="portal-form"/);
  assert.match(html, /<script src="lib\/portal\.js"><\/script>\s*<script src="popup\.js"><\/script>/);
});
