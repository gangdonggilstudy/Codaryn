/**
 * DR-29, DR-32 (c): a comparison view shows a changed file's texts only when the secrets registered
 * now mask them exactly as the run did (changeShownMatches), with the real privacy gateway. The
 * record holds digests of the visible parts, not the parts (R-19 L-3).
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";

import {
  CLI_ERROR_HINTS,
  FIXED_MESSAGES,
  MESSAGE_IDS,
  PARKED_DIR_NAME,
  changeShownMatches,
  maskedParts,
  maskedPartsEncoding,
  sameMaskedParts,
} from "../../../src/contracts/index.js";
import type { ChangeNow, ChangeShown, CliErrorOutput, ContentHash, ListParkedFiles, ParkedFile, PrivacyGateway, SkippedFile } from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";

const SECRET = "zz-dr29-fake-client-zz";
const ORIGINAL = `deploy:\n  token: ${SECRET}\n  region: eu\n`;
const NEXT = `deploy:\n  token: ${SECRET}\n  region: eu\n  zone: b\n`;
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex") as ContentHash;

function mask(gateway: PrivacyGateway, text: string): string {
  const masked = gateway.mask(text);
  assert.ok(masked.ok);
  return masked.text;
}

/** DR-32 (c): the digest every side computes: SHA-256 of maskedPartsEncoding(maskedParts(masked text)). */
const digestOf = (gateway: PrivacyGateway, text: string) => sha(maskedPartsEncoding(maskedParts(mask(gateway, text))));

/** What the run records with its own gateway (ChangeRecorder.saveOriginal and saveNext). */
function recorded(gateway: PrivacyGateway, original: string | null, next: string): ChangeShown {
  return {
    original: original === null ? null : digestOf(gateway, original),
    next: { sha256: sha(next), partsDigest: digestOf(gateway, next) },
  };
}

/** What a view has now, computed the same way with the gateway of now. */
function nowWith(gateway: PrivacyGateway, original: string | null, current: string | null, sha256: ContentHash = sha(NEXT)): ChangeNow {
  return {
    original: original === null ? null : digestOf(gateway, original),
    current: current === null ? null : { sha256, partsDigest: digestOf(gateway, current) },
  };
}

describe("DR-29: changed files are shown only when masked as the run masked them", () => {
  const runGateway = createPrivacyGateway({ secrets: [SECRET] });
  const shown = recorded(runGateway, ORIGINAL, NEXT);

  test("DR-32 (c): the record holds neither the secret nor the visible text, only digests", () => {
    const text = JSON.stringify(shown);
    assert.doesNotMatch(text, new RegExp(SECRET));
    for (const visible of ["deploy", "token", "region", "zone"]) assert.equal(text.includes(visible), false, visible);
    assert.match(shown.original ?? "", /^[0-9a-f]{64}$/);
    assert.match(shown.next?.partsDigest ?? "", /^[0-9a-f]{64}$/);
  });

  test("the digest is of the JSON of the parts list", () => {
    assert.equal(maskedPartsEncoding(["a", "", "b"]), '["a","","b"]');
    assert.notEqual(sha(maskedPartsEncoding(["ab"])), sha(maskedPartsEncoding(["a", "b"])), "a token between parts counts");
  });

  test("the same secrets now: shown", () => {
    assert.equal(changeShownMatches(shown, nowWith(createPrivacyGateway({ secrets: [SECRET] }), ORIGINAL, NEXT)), true);
  });

  test("reproduction: without the run's secret the value would be shown, so nothing is shown", () => {
    const none = createPrivacyGateway({ secrets: [] });
    assert.match(mask(none, ORIGINAL), new RegExp(SECRET), "masked with no secrets, the value stays visible");
    assert.equal(changeShownMatches(shown, nowWith(none, ORIGINAL, NEXT)), false);
  });

  test("masking more now is a difference too", () => {
    assert.equal(changeShownMatches(shown, nowWith(createPrivacyGateway({ secrets: [SECRET, "region: eu"] }), ORIGINAL, NEXT)), false);
  });

  test("the file changed since the run, no record, no next, or no current text: nothing is shown", () => {
    const now = createPrivacyGateway({ secrets: [SECRET] });
    assert.equal(changeShownMatches(shown, nowWith(now, ORIGINAL, NEXT, sha("edited later"))), false);
    assert.equal(changeShownMatches(undefined, nowWith(now, ORIGINAL, NEXT)), false);
    assert.equal(changeShownMatches({ ...shown, next: null }, nowWith(now, ORIGINAL, NEXT)), false);
    assert.equal(changeShownMatches(shown, nowWith(now, ORIGINAL, null)), false);
  });

  test("a created file: shown when both sides have no original, not when only one does", () => {
    const now = createPrivacyGateway({ secrets: [SECRET] });
    const created = recorded(runGateway, null, NEXT);
    assert.equal(changeShownMatches(created, nowWith(now, null, NEXT)), true);
    assert.equal(changeShownMatches(created, nowWith(now, ORIGINAL, NEXT)), false);
    assert.equal(changeShownMatches(shown, nowWith(now, null, NEXT)), false);
  });

  test("sameMaskedParts compares part by part", () => {
    assert.equal(sameMaskedParts(["", "/a"], ["", "/a"]), true);
    assert.equal(sameMaskedParts(["", "/a"], ["", "", "/a"]), false);
    assert.equal(sameMaskedParts(["x"], ["y"]), false);
  });
});

describe("R-16 L-1: a file a revert moved aside and could not put back is findable", () => {
  test("the skipped entry names where it was left; the folder is fixed", async () => {
    const skipped: SkippedFile = { path: "a.txt", reason: "io_error", parkedAt: `.codaryn/${PARKED_DIR_NAME}/20261112T120500Z-0000bbbb/3-0123456789abcdef` };
    assert.equal(PARKED_DIR_NAME, "parked");
    assert.match(skipped.parkedAt ?? "", /^\.codaryn\/parked\/[^/]+\/[0-9]+-[0-9a-f]+$/);
    const list: ListParkedFiles = async () => [{ path: skipped.parkedAt ?? "", runId: "20261112T120500Z-0000bbbb" } satisfies ParkedFile];
    assert.equal((await list("/work")).length, 1);
  });

  test("the revert summary and doctor say how many files were left there", () => {
    assert.deepEqual(FIXED_MESSAGES["revert.parked"], { count: "count" });
    assert.deepEqual(FIXED_MESSAGES["doctor.lock.parked_left"], { count: "count" });
  });
});

describe("R-12 L-2: an error's hint reaches the person's stderr too", () => {
  test("the quick form's config need has a hint and its own message id", () => {
    // U-37 added the reasons of argument, input and setting errors after it (g-u37-error-hints).
    assert.equal(CLI_ERROR_HINTS[0], "quick_form_needs_task");
    assert.ok((MESSAGE_IDS as readonly string[]).includes("error.hint.quick_form_needs_task"));
    const output: CliErrorOutput = { schemaVersion: 1, kind: "error", code: "invalid_config", exitCode: 2, message: "m", hint: "quick_form_needs_task" };
    assert.equal(output.hint, "quick_form_needs_task");
  });
});
