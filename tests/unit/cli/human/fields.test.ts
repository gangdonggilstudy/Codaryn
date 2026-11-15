/**
 * N-6, N-15 helpers: field positions and the closest known name. Neither returns file text.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TOP_LEVEL_POSITION, closestKnownName, fieldPath } from "../../../../src/cli/human/fields.js";
import { toSchemaFieldPath } from "../../../../src/contracts/index.js";

const CONFIG_FIELDS = ["schemaVersion", "model", "maxOutputTokens", "limits", "policy", "verifiers", "secretEnv", "integrity", "language", "profiles"];

describe("fieldPath", () => {
  test("joins known names and indexes", () => {
    assert.equal(fieldPath([]), TOP_LEVEL_POSITION);
    assert.equal(fieldPath(["limits", "maxModelTurns"]), "limits.maxModelTurns");
    assert.equal(fieldPath(["policy", "commands", 2, "args", 0]), "policy.commands[2].args[0]");
  });

  test("anything that is not a plain field name or index shows as ?", () => {
    const secret = "fake-secret N6 VALUE";
    const shown = fieldPath(["profiles", secret, "limits", -1, 1.5, "a\u001b[31m"]);
    assert.equal(shown, "profiles.?.limits[?][?].?");
    assert.equal(shown.includes("fake"), false);
  });
});

describe("fieldPath (N-23 c)", () => {
  test("only schema field names are shown; profile names, map keys and unknown names become ?", () => {
    assert.equal(fieldPath(["profiles", "hunter2-secret", "limits", "maxModelTurns"]), "profiles.?.limits.maxModelTurns");
    assert.equal(fieldPath(["limits", "hunter2Password"]), "limits.?");
    assert.equal(fieldPath(["hunter2"]), "?");
    const indexed = fieldPath(["profiles", 3, "limits", "maxModelTurns"]);
    assert.equal(indexed, "profiles[3].limits.maxModelTurns");
    assert.notEqual(toSchemaFieldPath(indexed), null, "a position made of schema names is a SchemaFieldPath");
  });

  test("closestKnownName offers only schema field names", () => {
    assert.equal(closestKnownName("hunter3", ["hunter2", "model"]), null);
    assert.equal(closestKnownName("modl", ["hunter2", "model"]), "model");
  });
});

describe("closestKnownName", () => {
  test("suggests a known name for typing slips and case differences", () => {
    assert.equal(closestKnownName("modle", CONFIG_FIELDS), "model");
    assert.equal(closestKnownName("Model", CONFIG_FIELDS), "model");
    assert.equal(closestKnownName("limit", CONFIG_FIELDS), "limits");
    assert.equal(closestKnownName("verifier", CONFIG_FIELDS), "verifiers");
    assert.equal(closestKnownName("maxOutputToken", CONFIG_FIELDS), "maxOutputTokens");
    assert.equal(closestKnownName("languag", CONFIG_FIELDS), "language");
  });

  test("suggests nothing when no known name is close", () => {
    assert.equal(closestKnownName("apiKey", CONFIG_FIELDS), null);
    assert.equal(closestKnownName("x", CONFIG_FIELDS), null);
    assert.equal(closestKnownName("", CONFIG_FIELDS), null);
    assert.equal(closestKnownName("m".repeat(500), CONFIG_FIELDS), null);
    assert.equal(closestKnownName("model", CONFIG_FIELDS), null, "an exact known name is not unknown");
  });

  test("only ever returns an entry of the known list, never the unknown name", () => {
    const secret = "fake-secret-N6-VALUE-0002";
    // The first entry is close but not a field name (it has spaces), so it is never offered.
    assert.equal(closestKnownName("fake secret N6 0002", ["fake secret N6 0003", "model"]), null);
    for (const name of ["modl", "MODEL", "mode1", secret]) {
      const answer = closestKnownName(name, CONFIG_FIELDS);
      assert.ok(answer === null || CONFIG_FIELDS.includes(answer), name);
    }
  });
});
