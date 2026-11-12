import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

function loadTour() {
  const context = vm.createContext({ console });
  vm.runInContext(readFileSync(join(src, "lib/tour.js"), "utf8"), context, {
    filename: "lib/tour.js",
  });
  return context.OneJobTour;
}

test("the tour module loads without a DOM", () => {
  const tour = loadTour();
  assert.equal(typeof tour.start, "function");
  assert.equal(typeof tour.place, "function");
  assert.equal(typeof tour.center, "function");
});

test("the card goes below a target with room under it", () => {
  const tour = loadTour();
  const position = tour.place(
    { top: 100, left: 400, width: 20, height: 20 },
    { width: 340, height: 150 },
    { width: 1280, height: 800 },
  );
  assert.equal(position.top, 130);
  assert.equal(position.left, 240);
  assert.equal(position.placement, "below");
});

test("the card flips above a target near the bottom", () => {
  const tour = loadTour();
  const position = tour.place(
    { top: 700, left: 400, width: 20, height: 20 },
    { width: 340, height: 150 },
    { width: 1280, height: 800 },
  );
  assert.equal(position.placement, "above");
  assert.equal(position.top, 540);
});

test("the card is clamped to the viewport on both edges", () => {
  const tour = loadTour();
  const card = { width: 340, height: 150 };
  const viewport = { width: 1280, height: 800 };

  const right = tour.place({ top: 100, left: 1270, width: 20, height: 20 }, card, viewport);
  assert.equal(right.left, 1280 - 340 - 12);

  const left = tour.place({ top: 100, left: 0, width: 20, height: 20 }, card, viewport);
  assert.equal(left.left, 12);
});

test("a card taller than the space stays inside the viewport", () => {
  const tour = loadTour();
  const position = tour.place(
    { top: 280, left: 100, width: 20, height: 20 },
    { width: 340, height: 400 },
    { width: 400, height: 300 },
  );
  assert.equal(position.top, 12);
  assert.equal(position.left, 12);
});

test("a step with nothing to point at centres the card", () => {
  const tour = loadTour();
  const position = tour.center(
    { width: 340, height: 260 },
    { width: 1280, height: 800 },
  );
  assert.equal(position.top, 270);
  assert.equal(position.left, 470);
  assert.equal(position.placement, "center");
});

test("a centred card stays inside a viewport smaller than itself", () => {
  const tour = loadTour();
  const position = tour.center(
    { width: 340, height: 260 },
    { width: 300, height: 200 },
  );
  assert.equal(position.top, 12);
  assert.equal(position.left, 12);
});

test("the tour refuses to start without steps or a document", () => {
  const tour = loadTour();
  assert.equal(tour.start({ steps: [] }), null);
  assert.equal(tour.start({ steps: [{ title: "One", body: "Body" }] }), null);
});
