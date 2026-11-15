/**
 * SP-0 (docs/design/second-provider.md 7절, P-1 to P-6): the Anthropic adapter's requests and
 * results stay exactly as they were on main before the provider work (SP-1 to SP-3). Each
 * scenario's result must equal its pinned value in `sp0-golden.ts`:
 * - P-1 request bodies (SHA-256 and length), P-2 request line and headers (the key's value shown as
 *   `<key>`), P-3 retry order and waits, P-4 error messages, P-5 response parsing, P-6 model list.
 * A failure here means the adapter now sends or returns something else. Fake transport only; no
 * real API request.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SP0_GOLDEN } from "./sp0-golden.js";
import { FAKE_KEY, KEY_SHAPED, p1Bodies, p2RequestLine, p3Retries, p4Errors, p5Responses, p6Models } from "./sp0-scenarios.js";

const sections = {
  p1Bodies,
  p2RequestLine,
  p3Retries,
  p4Errors,
  p5Responses,
  p6Models,
} as const;

describe("SP-0: the Anthropic adapter stays byte for byte as pinned", () => {
  test("every section is pinned", () => {
    assert.deepEqual(Object.keys(SP0_GOLDEN).sort(), Object.keys(sections).sort());
  });

  for (const [name, run] of Object.entries(sections)) {
    test(`${name}: each scenario equals its pinned value`, async () => {
      const actual = (await run()) as Record<string, unknown>;
      const pinned = SP0_GOLDEN[name] as Record<string, unknown>;
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(pinned).sort(), "the same scenarios");
      for (const key of Object.keys(pinned)) {
        assert.deepEqual(actual[key], pinned[key], `${name}.${key}`);
      }
    });
  }

  test("the pins hold neither the key's value nor a key-shaped text", () => {
    const text = JSON.stringify(SP0_GOLDEN);
    assert.equal(text.includes(FAKE_KEY), false);
    assert.equal(text.includes(KEY_SHAPED), false);
  });
});
