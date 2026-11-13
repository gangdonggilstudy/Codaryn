/**
 * U-187 (p5a request): the policy module exports its path set matcher itself, the same functions as
 * path-set.ts, so a caller judges a list of workspace paths with the gate's rule and not a copy.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { checkPathSetFormat, checkProtectedPaths, compilePathSet } from "../../../src/policy/index.js";
import type { PathSet, PathSetOptions } from "../../../src/policy/index.js";
import * as pathSet from "../../../src/policy/path-set.js";

describe("U-187: compilePathSet from src/policy", () => {
  test("the same functions as path-set.ts, the format rule the protected paths' one", () => {
    assert.equal(compilePathSet, pathSet.compilePathSet);
    assert.equal(checkPathSetFormat, pathSet.checkPathSetFormat);
    assert.equal(checkProtectedPaths, checkPathSetFormat);
  });

  test("usable with its types: an exact allow list judged on the text", () => {
    const options: PathSetOptions = { match: "exact", onUnusable: "misses" };
    const set: PathSet = compilePathSet(["docs/a.md"], options);
    assert.deepEqual([set.covers("docs/a.md"), set.covers("docs/a.md/x"), set.covers("docs")], [true, false, false]);
  });
});
