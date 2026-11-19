import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "src", "lib", "keyboard-shortcuts.js"), "utf8");
const context = vm.createContext({ console, URLSearchParams });
vm.runInContext(source, context, { filename: "lib/keyboard-shortcuts.js" });
const shortcuts = context.OneJobKeyboardShortcuts;

test("plain shortcuts accept only unmodified, non-repeating, non-composing keys", () => {
  assert.equal(shortcuts.matches({ key: "O" }, "o"), true);
  assert.equal(shortcuts.matches({ key: ",", code: "Comma" }, ","), true);
  assert.equal(shortcuts.matches({ key: ".", code: "Period" }, "."), true);
  for (const event of [
    { key: "o", altKey: true },
    { key: "o", ctrlKey: true },
    { key: "o", metaKey: true },
    { key: "o", shiftKey: true },
    { key: "o", repeat: true },
    { key: "o", isComposing: true },
    { key: "o", keyCode: 229 },
  ]) {
    assert.equal(shortcuts.matches(event, "o"), false);
  }
});

test("editable elements are detected through composed shadow paths", () => {
  const input = { tagName: "INPUT" };
  assert.equal(shortcuts.isEditableEvent({ composedPath: () => [input] }), true);
  assert.equal(
    shortcuts.isEditableEvent({ composedPath: () => [{ tagName: "SPAN", isContentEditable: true }] }),
    true,
  );
  assert.equal(shortcuts.isEditableEvent({ composedPath: () => [{ tagName: "BUTTON" }] }), false);
});

test("shortcut help includes concise descriptions of the extension features", () => {
  const titles = Array.from(shortcuts.FEATURE_GUIDE, (feature) => feature.title);
  assert.deepEqual(titles, [
    "Resources and pins",
    "Booking Overview",
    "Bookings heatmap",
    "Resource Statistics",
    "Caro Week View",
    "Settings",
  ]);
  assert.ok(shortcuts.FEATURE_GUIDE.every((feature) => feature.description.length > 30));
});

test("calendar range shifts preserve the span and other query parameters", () => {
  const shifted = new URLSearchParams(shortcuts.shiftDateRange(
    "start=2026-11-02T00%3A00%3A00.000%2B00%3A00&end=2026-11-09T00%3A00%3A00.000%2B00%3A00&group=Machines%3A+CNC+&onejob-resource=42",
    7,
  ));
  assert.equal(shifted.get("group"), "Machines: CNC ");
  assert.equal(shifted.get("onejob-resource"), "42");
  assert.equal(new Date(shifted.get("start")).getDate(), 9);
  assert.equal(new Date(shifted.get("end")).getDate(), 16);
  assert.equal(shortcuts.shiftDateRange("start=bad&end=bad", 1), null);
});

test("dynamic pill shortcuts are unique and avoid global bindings", () => {
  const makeButton = (label, preferred = "") => ({
    dataset: { shortcutLabel: label, shortcutPreferred: preferred },
    title: "",
    attributes: {},
    getAttribute() {
      return "";
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  });
  const buttons = [
    makeButton("Single resource", "i"),
    makeButton("Pinned"),
    makeButton("My bookings", "m"),
  ];
  shortcuts.assignShortcuts(buttons);
  const keys = buttons.map((button) => button.dataset.onejobShortcut);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys, ["i", "n", "m"]);
  assert.ok(keys.every((key) => !shortcuts.GLOBAL_KEYS.has(key)));
  assert.equal(buttons[0].attributes["aria-keyshortcuts"], "I");
});
