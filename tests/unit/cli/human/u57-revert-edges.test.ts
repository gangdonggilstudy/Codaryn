/**
 * U-57 (UXM-21, docs/design/ux-midpoint-review.md), the part the human renderer can close alone: a
 * revert preview with nothing to revert ended with "Run again without --dry-run to revert." although
 * a real revert would do nothing either (a dry run makes the same decisions, src/contracts/changes.ts;
 * it only skips files). Reproduced on main 4010905 with the real CLI: a second `revert --dry-run` of
 * an apply run already reverted printed "Files to revert: 0 … Run again without --dry-run".
 * Now the preview gives that line only when it lists a file to revert. Everything else stays: the
 * header, the skipped files, the earlier revert's line, a preview with files, the real revert.
 * Real catalogs, both languages; fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES } from "../../../../src/contracts/index.js";
import type { RevertOutput } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const RUN = "20261113T050607Z-0a1b2c3d";
const BEFORE = { at: "2026-11-13T05:07:08.000Z", status: "complete" as const };
const revert = (extra: Partial<RevertOutput>): RevertOutput =>
  ({ schemaVersion: 1, kind: "revert", runId: RUN, status: "complete", exitCode: 0, reverted: [], skipped: [], ...extra }) as RevertOutput;
const MOVED_BACK = { path: "a.txt", action: "moved_back", from: "sorted/a.txt" } as RevertOutput["reverted"][number];

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const out = createHumanOutput(catalog);
  const next = catalog.format("revert.dry_run_next");
  const linesOf = (output: RevertOutput): string[] => out.revertSummary(output).trimEnd().split("\n");

  describe(`U-57 (UXM-21), ${language}: a preview with nothing to revert does not ask to run again`, () => {
    test("the reproduction: a second preview of a reverted apply run (0 to revert, 1 already reverted, the earlier revert)", () => {
      const lines = linesOf(revert({ dryRun: true, skipped: [{ path: "a.txt", reason: "already_reverted" }], revertedBefore: BEFORE }));
      assert.equal(lines.includes(next), false, lines.join("\n"));
      // The renderer puts a title's own colon after the code (`… (complete):`).
      assert.ok(lines[0]?.includes(catalog.format("revert.dry_run_title", { count: 0 }).replace(/:$/, "")), lines.join("\n"));
      assert.ok(lines.some((line) => line.startsWith(catalog.format("revert.reverted_before"))), lines.join("\n"));
      assert.equal(lines.at(-1)?.startsWith(catalog.format("revert.reverted_before")), true, lines.join("\n"));
    });

    test("nothing at all, or only files that cannot go back: no line to run again", () => {
      for (const skipped of [[], [{ path: "b.txt", reason: "changed_since_run" }], [{ path: "c.txt", reason: "original_path_taken" }]] as RevertOutput["skipped"][]) {
        assert.equal(linesOf(revert({ dryRun: true, skipped })).includes(next), false, JSON.stringify(skipped));
      }
    });

    test("a preview with a file to revert still ends with it, after the move-safety line", () => {
      const lines = linesOf(revert({ dryRun: true, moveSafetyUnchecked: true, reverted: [MOVED_BACK] }));
      assert.equal(lines.at(-1), next, lines.join("\n"));
      assert.equal(lines.at(-2), catalog.format("revert.dry_run_move_unchecked"), lines.join("\n"));
    });

    test("a real revert never has it, with files or without", () => {
      for (const reverted of [[], [MOVED_BACK]]) assert.equal(linesOf(revert({ reverted })).includes(next), false);
    });
  });
}
