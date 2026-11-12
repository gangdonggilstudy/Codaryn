/**
 * DR-21: the GUI's consent to unsafe moves becomes G-A's UnsafeMoveConsent with channel `adapter`,
 * for the plan being applied only. Fake digests only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { unsafeMoveConsentOf } from "../../../src/app/index.js";
import type { UnsafeMoveConsentRequest } from "../../../src/app/index.js";

const PLAN = "a".repeat(52) + "0123456789ab";
const OTHER = "b".repeat(64);

function refused(digest: string, consent: UnsafeMoveConsentRequest | null): string | null {
  const outcome = unsafeMoveConsentOf({ digest, unsafeMoveConsent: consent });
  return outcome.ok ? null : outcome.error.code;
}

describe("unsafeMoveConsentOf", () => {
  test("no consent stays none", () => {
    assert.deepEqual(unsafeMoveConsentOf({ digest: PLAN, unsafeMoveConsent: null }), { ok: true, consent: null });
  });

  test("a consent for the plan applied gets the channel adapter, also when the apply names a prefix", () => {
    for (const digest of [PLAN, PLAN.slice(0, 12), PLAN.slice(0, 40)]) {
      assert.deepEqual(unsafeMoveConsentOf({ digest, unsafeMoveConsent: { digest: PLAN } }), {
        ok: true,
        consent: { channel: "adapter", digest: PLAN },
      });
    }
  });

  test("the GUI cannot name another channel", () => {
    const forged = { digest: PLAN, channel: "cli-tty" } as UnsafeMoveConsentRequest;
    const outcome = unsafeMoveConsentOf({ digest: PLAN, unsafeMoveConsent: forged });
    assert.ok(outcome.ok);
    assert.equal(outcome.consent?.channel, "adapter");
    assert.deepEqual(Object.keys(outcome.consent ?? {}).sort(), ["channel", "digest"]);
  });

  test("a consent for another plan, or not naming a full digest, is refused before anything runs", () => {
    assert.equal(refused(PLAN, { digest: OTHER }), "invalid_arguments", "another plan");
    assert.equal(refused(PLAN.slice(0, 12), { digest: OTHER }), "invalid_arguments", "another plan, prefix applied");
    assert.equal(refused(PLAN.slice(0, 11), { digest: PLAN }), "invalid_arguments", "the apply's prefix is too short to tell plans apart");
    assert.equal(refused("", { digest: PLAN }), "invalid_arguments");
    for (const digest of [PLAN.slice(0, 12), PLAN.slice(0, 63), PLAN.toUpperCase(), `${PLAN} `, `${PLAN.slice(0, 63)}g`]) {
      assert.equal(refused(PLAN, { digest }), "invalid_arguments", `consent digest ${JSON.stringify(digest)}`);
    }
    assert.equal(refused(PLAN, {} as UnsafeMoveConsentRequest), "invalid_arguments");
    assert.equal(refused(PLAN, "yes" as unknown as UnsafeMoveConsentRequest), "invalid_arguments");
  });

  test("an error names no digest", () => {
    const outcome = unsafeMoveConsentOf({ digest: PLAN, unsafeMoveConsent: { digest: OTHER } });
    assert.ok(!outcome.ok);
    assert.equal(JSON.stringify(outcome).includes(OTHER.slice(0, 12)), false);
    assert.equal(JSON.stringify(outcome).includes(PLAN.slice(0, 12)), false);
  });
});
