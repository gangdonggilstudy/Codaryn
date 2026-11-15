/**
 * G-E: the human review record (review.json, GT-D6). It holds the verdict and the masked note only;
 * the run's result and journal are never changed by it. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { MAX_REVIEW_NOTE_CHARS } from "../../../src/contracts/index.js";
import type { MaskedText, ReviewRecord } from "../../../src/contracts/index.js";
import { readReviewRecord, writeReviewRecord } from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const RUN = "20260102T030405Z-0a1b2c3d";
const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

async function runWorkspace(): Promise<{ root: string; dir: string }> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-g-review-"));
  roots.push(root);
  const dir = join(root, ".codaryn", "runs", RUN);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "result.json"), '{"kind":"run"}\n', "utf8");
  return { root, dir };
}

function record(extra: Partial<ReviewRecord> = {}): ReviewRecord {
  return { schemaVersion: 1, kind: "review_record", runId: RUN, at: "2026-01-02T03:10:00.000Z", verdict: "accepted", note: "looks right" as MaskedText, ...extra };
}

describe("review record (G-E, GT-D6)", () => {
  test("is written atomically, read back, and replaced by a later review; other files stay as they are", async () => {
    const { root, dir } = await runWorkspace();
    assert.equal(await readReviewRecord(root, RUN), null);
    await writeReviewRecord(root, record());
    assert.deepEqual(await readReviewRecord(root, RUN), record());
    await writeReviewRecord(root, record({ verdict: "rejected", note: null, at: "2026-01-02T03:20:00Z" }));
    assert.deepEqual(await readReviewRecord(root, RUN), record({ verdict: "rejected", note: null, at: "2026-01-02T03:20:00Z" }));
    assert.equal(await readFile(join(dir, "result.json"), "utf8"), '{"kind":"run"}\n', "the result is not touched");
    assert.deepEqual((await readdir(dir)).sort(), ["result.json", "review.json"]);
  });

  test("an invalid record is refused before anything is written", async () => {
    const { root, dir } = await runWorkspace();
    const bad: Partial<ReviewRecord>[] = [
      { verdict: "maybe" as never },
      { at: "2026-02-30T00:00:00Z" },
      { note: "x".repeat(MAX_REVIEW_NOTE_CHARS + 1) as MaskedText },
      { note: "line one\nline two" as MaskedText },
      { kind: "revert_record" as never },
    ];
    for (const extra of bad) {
      await assert.rejects(writeReviewRecord(root, record(extra)), TypeError, JSON.stringify(extra));
    }
    assert.equal(await exists(join(dir, "review.json")), false);
  });

  test("a record that fails the checks is not read; a missing or linked run directory is not written", async () => {
    const { root, dir } = await runWorkspace();
    await writeFile(join(dir, "review.json"), '{"kind":"review_record","verdict":"accepted"}', "utf8");
    await assert.rejects(readReviewRecord(root, RUN));

    const empty = await mkdtemp(join(tmpdir(), "codaryn-g-review-"));
    roots.push(empty);
    await assert.rejects(writeReviewRecord(empty, record()));
    assert.equal(await exists(join(empty, ".codaryn")), false, "the run directory is not created");

    const { dir: elsewhere } = await runWorkspace();
    const linked = await mkdtemp(join(tmpdir(), "codaryn-g-review-"));
    roots.push(linked);
    await mkdir(join(linked, ".codaryn", "runs"), { recursive: true });
    await symlink(elsewhere, join(linked, ".codaryn", "runs", RUN), "junction");
    await assert.rejects(writeReviewRecord(linked, record()));
    assert.equal(await exists(join(elsewhere, "review.json")), false, "nothing is written where the link leads");
    await assert.rejects(readReviewRecord(linked, RUN));
  });
});
