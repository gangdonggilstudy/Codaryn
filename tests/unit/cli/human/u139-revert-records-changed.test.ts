/**
 * U-139 (UXM-6, PM): a revert of a run with a records-changed mark (DR-38) said so in its JSON only
 * (RevertOutput.recordsChanged); `runs` and `report` said it to people, revert's text did not. Now
 * revertSummary writes the catalog's revert.records_changed once, after the reverted and skipped
 * lists and before the lines of what comes next. Without the mark (absent or false) nothing is added.
 * Both languages with the real catalog. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { RevertOutput, RunId } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const RUN = toRunId("20261113T041345Z-084c6f3c") as RunId;
const revert = (extra: Partial<RevertOutput>): RevertOutput =>
  ({ schemaVersion: 1, kind: "revert", runId: RUN, status: "complete", exitCode: 0, reverted: [], skipped: [], ...extra }) as RevertOutput;
const MOVED_BACK = { path: "inbox/scan.pdf", action: "moved_back", from: "docs/scan.pdf" } as RevertOutput["reverted"][number];
const SKIPPED = { path: "inbox/old.tmp", reason: "changed_since_run" } as RevertOutput["skipped"][number];

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const out = createHumanOutput(catalog);
  const mark = catalog.format("revert.records_changed");
  const linesOf = (output: RevertOutput): string[] => out.revertSummary(output).trimEnd().split("\n");

  describe(`U-139 (${language}): revert tells of a records-changed mark`, () => {
    test("a preview and a revert of a marked run: the line once, after the lists, before what comes next", () => {
      for (const dryRun of [true, false]) {
        const lines = linesOf(revert({ ...(dryRun ? { dryRun: true as const } : {}), recordsChanged: true, reverted: [MOVED_BACK], skipped: [SKIPPED] }));
        assert.equal(lines.filter((line) => line === mark).length, 1, lines.join("\n"));
        const at = lines.indexOf(mark);
        const lastListed = Math.max(...lines.map((line, index) => (line.startsWith("  ") ? index : -1)));
        assert.ok(at > lastListed, `after the lists:\n${lines.join("\n")}`);
        if (dryRun) assert.equal(lines.at(-1), catalog.format("revert.dry_run_next"), "the preview's next line stays last");
      }
    });

    test("also when nothing is listed", () => {
      assert.ok(linesOf(revert({ recordsChanged: true })).includes(mark));
    });

    test("no mark (absent or false): nothing added; the rest is as without the field", () => {
      const without = linesOf(revert({ reverted: [MOVED_BACK], skipped: [SKIPPED] }));
      assert.equal(without.includes(mark), false);
      assert.deepEqual(linesOf(revert({ recordsChanged: false, reverted: [MOVED_BACK], skipped: [SKIPPED] })), without);
      const marked = linesOf(revert({ recordsChanged: true, reverted: [MOVED_BACK], skipped: [SKIPPED] }));
      assert.deepEqual(marked.filter((line) => line !== mark), without, "the mark is the only line added");
    });
  });
}
