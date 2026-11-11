// Example for the Codaryn code task. The second test fails until sum.mjs is fixed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { sum } from "./sum.mjs";

test("sum adds numbers", () => {
  assert.equal(sum([1, 2, 3]), 6);
});

test("sum of an empty list is 0", () => {
  assert.equal(sum([]), 0);
});
