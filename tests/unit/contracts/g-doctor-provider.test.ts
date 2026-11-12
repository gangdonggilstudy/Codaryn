/**
 * DR-36 (b): what `doctor` can say in the person's language about which provider's key goes where
 * (DR-34 (a)) and about another provider's variables a run does not read (R-19 I-4).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  API_ORIGIN_PATTERN_SOURCE,
  API_PROVIDER_NAMES,
  FIXED_MESSAGES,
  SCHEMA_FIELD_NAMES,
  toApiOrigin,
  toSchemaFieldPath,
} from "../../../src/contracts/index.js";
import type { ApiOrigin, DoctorCheck, DoctorText, SchemaFieldPath } from "../../../src/contracts/index.js";

describe("DR-36 (b): the key's destination and other providers' variables in doctor's human text", () => {
  test("the message ids and their parameter kinds", () => {
    assert.deepEqual(FIXED_MESSAGES["doctor.api_key.sends_to_env"], { keyEnv: "keyEnv", provider: "provider", origin: "apiOrigin", variable: "settingEnv" });
    assert.deepEqual(FIXED_MESSAGES["doctor.api_key.sends_to_config"], { keyEnv: "keyEnv", provider: "provider", origin: "apiOrigin", field: "field" });
    assert.deepEqual(FIXED_MESSAGES["doctor.api_key.sends_to_default"], { keyEnv: "keyEnv", provider: "provider", origin: "apiOrigin" });
    assert.deepEqual(FIXED_MESSAGES["doctor.api_key.address_invalid"], { keyEnv: "keyEnv", variable: "settingEnv" });
    assert.deepEqual(FIXED_MESSAGES["doctor.model.other_provider_variable"], { variable: "settingEnv", owner: "provider", provider: "provider" });
  });

  test("an origin: scheme, host and port only, from an address that may be shown", () => {
    assert.equal(toApiOrigin("https://api.openai.com/v1"), "https://api.openai.com");
    assert.equal(toApiOrigin("https://gateway.example:8443/openai/v1"), "https://gateway.example:8443");
    assert.equal(toApiOrigin("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080");
    assert.equal(toApiOrigin("http://localhost:11434/v1"), "http://localhost:11434");
    assert.equal(toApiOrigin("http://[::1]:9/v1"), "http://[::1]:9");
    assert.equal(toApiOrigin("https://bücher.example/v1"), "https://xn--bcher-kva.example", "an international name in its ASCII form");
    for (const refused of ["http://api.example/v1", "https://user:secret@api.example/v1", "ftp://api.example", "not a url", "", "file:///etc/passwd"]) {
      assert.equal(toApiOrigin(refused), null, refused);
    }
    assert.equal(new RegExp(API_ORIGIN_PATTERN_SOURCE).test("https://api.example/v1"), false, "no path in an origin");
  });

  test("a check carries its text and notes, each typed; parameters are names and origins, never values", () => {
    const origin = toApiOrigin("https://api.openai.com/v1") as ApiOrigin;
    const field = toSchemaFieldPath("providers.openai.apiBaseUrl") as SchemaFieldPath;
    assert.equal(field, "providers.openai.apiBaseUrl", "a provider's config entry is a field position");
    const texts: DoctorText[] = [
      { id: "doctor.api_key.sends_to_env", params: { keyEnv: "OPENAI_API_KEY", provider: "openai", origin, variable: "CODARYN_OPENAI_API_BASE_URL" } },
      { id: "doctor.api_key.sends_to_config", params: { keyEnv: "OPENAI_API_KEY", provider: "openai", origin, field } },
      { id: "doctor.api_key.sends_to_default", params: { keyEnv: "ANTHROPIC_API_KEY", provider: "anthropic", origin } },
      { id: "doctor.api_key.address_invalid", params: { keyEnv: "ANTHROPIC_API_KEY", variable: "CODARYN_API_BASE_URL" } },
    ];
    const check: DoctorCheck = {
      id: "model",
      status: "ok",
      message: "the model and maxOutputTokens are set",
      text: { id: "doctor.model.ok" },
      notes: [{ id: "doctor.model.other_provider_variable", params: { variable: "CODARYN_OPENAI_MODEL", owner: "openai", provider: "anthropic" } }],
    };
    // @ts-expect-error an origin is made by toApiOrigin only
    const raw: DoctorText = { id: "doctor.api_key.sends_to_default", params: { keyEnv: "ANTHROPIC_API_KEY", provider: "anthropic", origin: "https://x.example" } };
    // @ts-expect-error a key variable is not a setting variable
    const key: DoctorText = { id: "doctor.model.other_provider_variable", params: { variable: "OPENAI_API_KEY", owner: "openai", provider: "anthropic" } };
    assert.ok(texts.length === 4 && check.notes?.length === 1 && raw && key);
  });

  test("every API provider name is a field name", () => {
    for (const name of API_PROVIDER_NAMES) assert.ok((SCHEMA_FIELD_NAMES as readonly string[]).includes(name), name);
  });
});
