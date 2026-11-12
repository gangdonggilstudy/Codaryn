/**
 * DR-29: a comparison view shows a changed file's texts only when the secrets registered now mask
 * them exactly as the run did (changeShownMatches), with the real privacy gateway. The R-11/A-4
 * reproduction: a run that hid a value, viewed without that secret, would show it in plain text.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";

import { PARKED_DIR_NAME, changeShownMatches, maskedParts, sameMaskedParts } from "../../../src/contracts/index.js";
import type { ChangeShown, ContentHash, ListParkedFiles, ParkedFile, PrivacyGateway, SkippedFile } from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";

const SECRET = "zz-dr29-fake-client-zz";
const ORIGINAL = `client: ${SECRET}\nline two\n`;
const NEXT = `client: ${SECRET}\nline two\nline three\n`;
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex") as ContentHash;

function mask(gateway: PrivacyGateway, text: string): string {
  const masked = gateway.mask(text);
  assert.ok(masked.ok);
  return masked.text;
}

/** What the run records with its own gateway (ChangeRecorder.saveOriginal and saveNext). */
function recorded(gateway: PrivacyGateway, original: string | null, next: string): ChangeShown {
  return {
    original: original === null ? null : maskedParts(mask(gateway, original)),
    next: { sha256: sha(next), parts: maskedParts(mask(gateway, next)) },
  };
}

describe("DR-29: changed files are shown only when masked as the run masked them", () => {
  const runGateway = createPrivacyGateway({ secrets: [SECRET] });
  const shown = recorded(runGateway, ORIGINAL, NEXT);

  test("the recorded parts hold no secret value", () => {
    assert.doesNotMatch(JSON.stringify(shown), new RegExp(SECRET));
  });

  test("the same secrets now: shown", () => {
    const now = createPrivacyGateway({ secrets: [SECRET] });
    assert.equal(
      changeShownMatches(shown, { original: mask(now, ORIGINAL), current: { sha256: sha(NEXT), masked: mask(now, NEXT) } }),
      true,
    );
  });

  test("reproduction: without the run's secret the value would be shown, so nothing is shown", () => {
    const none = createPrivacyGateway({ secrets: [] });
    const original = mask(none, ORIGINAL);
    assert.match(original, new RegExp(SECRET), "masked with no secrets, the value stays visible");
    assert.equal(changeShownMatches(shown, { original, current: { sha256: sha(NEXT), masked: mask(none, NEXT) } }), false);
  });

  test("masking more now is a difference too", () => {
    const more = createPrivacyGateway({ secrets: [SECRET, "line two"] });
    assert.equal(
      changeShownMatches(shown, { original: mask(more, ORIGINAL), current: { sha256: sha(NEXT), masked: mask(more, NEXT) } }),
      false,
    );
  });

  test("the file changed since the run, no record, no next, or no current text: nothing is shown", () => {
    const now = createPrivacyGateway({ secrets: [SECRET] });
    const original = mask(now, ORIGINAL);
    const current = { sha256: sha(NEXT), masked: mask(now, NEXT) };
    assert.equal(changeShownMatches(shown, { original, current: { ...current, sha256: sha("edited later") } }), false);
    assert.equal(changeShownMatches(undefined, { original, current }), false);
    assert.equal(changeShownMatches({ ...shown, next: null }, { original, current }), false);
    assert.equal(changeShownMatches(shown, { original, current: null }), false);
  });

  test("a created file: shown when both sides have no original, not when only one does", () => {
    const now = createPrivacyGateway({ secrets: [SECRET] });
    const created = recorded(runGateway, null, NEXT);
    const current = { sha256: sha(NEXT), masked: mask(now, NEXT) };
    assert.equal(changeShownMatches(created, { original: null, current }), true);
    assert.equal(changeShownMatches(created, { original: mask(now, ORIGINAL), current }), false);
    assert.equal(changeShownMatches(shown, { original: null, current }), false);
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
});
