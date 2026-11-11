import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { API_BASE_URL_STRICT_RULE, normalizeApiBaseUrlStrict } from "../../../../src/cli/security/index.js";

const REJECTED = { ok: false, message: `apiBaseUrl ${API_BASE_URL_STRICT_RULE}` };

describe("S-9 normalizeApiBaseUrlStrict", () => {
  test("accepts https and loopback http, without a trailing slash", () => {
    const cases: [string, string][] = [
      ["https://api.anthropic.com", "https://api.anthropic.com"],
      ["https://api.anthropic.com/", "https://api.anthropic.com"],
      ["HTTPS://API.Anthropic.COM", "https://api.anthropic.com"],
      ["https://proxy.example.test/anthropic/", "https://proxy.example.test/anthropic"],
      ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
      ["http://localhost:3000/", "http://localhost:3000"],
      ["http://[::1]:9", "http://[::1]:9"],
    ];
    for (const [input, expected] of cases) {
      assert.deepEqual(normalizeApiBaseUrlStrict(input, "apiBaseUrl"), { ok: true, url: expected }, input);
    }
  });

  test("H1-4: a bare trailing ? or # is rejected", () => {
    for (const input of ["https://api.anthropic.com/x?", "https://api.anthropic.com/x#", "https://api.anthropic.com?", "https://api.anthropic.com/#"]) {
      assert.deepEqual(normalizeApiBaseUrlStrict(input, "apiBaseUrl"), REJECTED, input);
    }
  });

  test("a base that already ends with /v1 is rejected instead of becoming /v1/v1/messages", () => {
    for (const input of ["https://api.anthropic.com/v1", "https://api.anthropic.com/v1/", "https://proxy.example.test/x/V1", "https://api.anthropic.com/v1/messages"]) {
      assert.deepEqual(normalizeApiBaseUrlStrict(input, "apiBaseUrl"), REJECTED, input);
    }
    assert.equal(normalizeApiBaseUrlStrict("https://proxy.example.test/v1beta", "apiBaseUrl").ok, true);
  });

  test("rejects everything else without echoing the value", () => {
    for (const input of [
      "https://user:pass@api.anthropic.com",
      "https://api.anthropic.com/?a=1",
      "https://api.anthropic.com/#frag",
      "http://example.test",
      "http://localhost.evil.test",
      "http://[::ffff:127.0.0.1]",
      "file:///etc/passwd",
      "ftp://api.anthropic.com",
      "https://api.anthropic.com\\@evil.test",
      "https://api.anthropic.com/a b",
      " https://api.anthropic.com",
      "https://api.anthropic.com\t",
      "https://api.anth\nropic.com",
      "",
      "not a url",
    ]) {
      const outcome = normalizeApiBaseUrlStrict(input, "apiBaseUrl");
      assert.deepEqual(outcome, REJECTED, JSON.stringify(input));
    }
    assert.deepEqual(normalizeApiBaseUrlStrict(42, "CODARYN_API_BASE_URL"), {
      ok: false,
      message: `CODARYN_API_BASE_URL ${API_BASE_URL_STRICT_RULE}`,
    });
  });
});
