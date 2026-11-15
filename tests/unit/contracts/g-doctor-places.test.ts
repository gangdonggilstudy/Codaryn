/**
 * The CLI's requests (N-A 32.3, 33.3): doctor names where the config file came from, and the
 * provider's model variable and config place for a missing model or output cap.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FIXED_MESSAGES, toSchemaFieldPath } from "../../../src/contracts/index.js";
import type { DoctorText, SchemaFieldPath } from "../../../src/contracts/index.js";

const field = (path: string) => toSchemaFieldPath(path) as SchemaFieldPath;

describe("doctor: the config file's source and the model's places", () => {
  test("the message ids and their parameters", () => {
    assert.deepEqual(FIXED_MESSAGES["doctor.config_file.valid_at"], { location: "location" });
    assert.deepEqual(FIXED_MESSAGES["doctor.config_file.valid_given"], { location: "location" });
    assert.deepEqual(FIXED_MESSAGES["doctor.model.missing"], { variable: "settingEnv", field: "field" });
    assert.deepEqual(FIXED_MESSAGES["doctor.model.output_cap_missing"], { field: "field" });
  });

  test("typed texts for both providers' places", () => {
    const texts: DoctorText[] = [
      { id: "doctor.config_file.valid_given", params: { location: "--config" } },
      { id: "doctor.config_file.valid_given", params: { location: "CODARYN_CONFIG" } },
      { id: "doctor.model.missing", params: { variable: "CODARYN_MODEL", field: field("model") } },
      { id: "doctor.model.missing", params: { variable: "CODARYN_OPENAI_MODEL", field: field("providers.openai.model") } },
      { id: "doctor.model.output_cap_missing", params: { field: field("providers.openai.maxOutputTokens") } },
    ];
    for (const path of ["model", "maxOutputTokens", "providers.openai.model", "providers.anthropic.maxOutputTokens"]) {
      assert.equal(toSchemaFieldPath(path), path, path);
    }
    // @ts-expect-error a model place needs the provider's model variable
    const noVariable: DoctorText = { id: "doctor.model.missing", params: { field: field("model") } };
    assert.ok(texts.length === 5 && noVariable);
  });
});
