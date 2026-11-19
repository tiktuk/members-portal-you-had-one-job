import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "src", "lib", "resource-picker.js"), "utf8");
const context = vm.createContext({ console });
vm.runInContext(source, context, { filename: "lib/resource-picker.js" });
const picker = context.OneJobResourcePicker;

test("fuzzyScore matches subsequences and rejects non-matches", () => {
  assert.equal(picker.fuzzyScore("xl", "Prusa - XL") != null, true);
  assert.equal(picker.fuzzyScore("cnc", "OLSK Large CNC") != null, true);
  assert.equal(picker.fuzzyScore("abc", "abc") != null, true);
  assert.equal(picker.fuzzyScore("xyz", "Prusa - XL"), null);
  assert.equal(picker.fuzzyScore("lx", "Prusa - XL"), null); // wrong order
  assert.equal(picker.fuzzyScore("", "anything"), 0);
});

test("fuzzyScore prefers word starts and contiguous runs", () => {
  const contiguous = picker.fuzzyScore("prusa", "Prusa - XL");
  const scattered = picker.fuzzyScore("prusa", "power rack uses a printer");
  assert.ok(contiguous > scattered);
  const wordStart = picker.fuzzyScore("xl", "Prusa - XL");
  const midWord = picker.fuzzyScore("xl", "excellent");
  assert.ok(wordStart > midWord);
});

test("rankItems filters, scores across name and subtitle, and sorts", () => {
  const items = [
    { name: "Prusa - XL", subtitle: "Machines · 3D printing", resource: { id: "1" } },
    { name: "Prusa - MK4", subtitle: "Machines · 3D printing", resource: { id: "2" } },
    { name: "OLSK Large CNC", subtitle: "Machines · CNC Machining", resource: { id: "3" } },
    { name: "eufyMake E1 UV Printer", subtitle: "Machines · UV printing", resource: { id: "4" } },
  ];
  const prusa = picker.rankItems("pru", items).map((item) => item.name);
  assert.deepEqual(prusa.slice(0, 2), ["Prusa - XL", "Prusa - MK4"]);
  // A group word alone finds everything in that group via the subtitle.
  const cnc = picker.rankItems("cnc", items).map((item) => item.name);
  assert.deepEqual(cnc, ["OLSK Large CNC"]);
  // Queries can span name and subtitle.
  const combined = picker.rankItems("prusa3d", items).map((item) => item.name);
  assert.deepEqual(combined.slice(0, 2), ["Prusa - XL", "Prusa - MK4"]);
  assert.deepEqual(picker.rankItems("zzz", items), []);
});
