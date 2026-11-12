/**
 * G-F: `codaryn changes` as the CLI connects it. The JSON form is one ASCII line (N-19) and hides
 * key shapes in every string before it is written (N-27 c, as report); help names the command.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AppCallOutcome, ChangesOutput, ChangesRequest } from "../../../src/app/index.js";
import { CHANGES_USAGE, runChanges } from "../../../src/cli/changes.js";
import { helpRequest, helpText } from "../../../src/cli/help.js";

/** Key-shaped, built at run time so the file never holds such a literal; BEL breaks it after "AB". */
const BROKEN_KEY_TAIL = "CDEFGHIJKLMNOPQRSTUVWXYZ012345";
const BROKEN_KEY = `${["sk", "ant", "AB"].join("-")}\u0007${BROKEN_KEY_TAIL}`;

const VIEW: ChangesOutput = {
  schemaVersion: 1,
  kind: "changes",
  runId: "20261112T010203Z-0a1b2c3d",
  exitCode: 0,
  masking: "current_secrets",
  files: [
    { path: "메모.md" as never, created: true, state: "as_run_left", before: null, after: `${BROKEN_KEY}\n` as never, unavailable: null },
  ],
};

const app = {
  async changes(_request: ChangesRequest): Promise<AppCallOutcome<ChangesOutput>> {
    return { ok: true, output: VIEW };
  },
};

describe("changes --json", () => {
  test("is one ASCII line that parses back, with a broken key shape hidden", async () => {
    const outcome = await runChanges({ argv: ["changes", "--workspace", ".", "--run", "latest", "--json"], env: {}, app });
    assert.ok("text" in outcome);
    assert.equal(outcome.text.split("\n").length, 2);
    assert.ok([...outcome.text].every((char) => char.charCodeAt(0) < 0x80), "ASCII only (N-19)");
    const parsed = JSON.parse(outcome.text) as ChangesOutput;
    assert.equal(parsed.files[0]?.path, "메모.md");
    assert.equal(outcome.text.includes(BROKEN_KEY_TAIL), false);
    assert.ok(parsed.files[0]?.after?.includes("[key]"));
  });
});

describe("changes in help", () => {
  test("codaryn help changes and codaryn changes --help print its usage", () => {
    for (const argv of [["help", "changes"], ["changes", "--help"]]) {
      const asked = helpRequest(argv);
      assert.ok(asked !== null && asked.kind === "help" && asked.command === "changes", JSON.stringify(argv));
      assert.ok(helpText(asked.command).includes(CHANGES_USAGE));
    }
    assert.ok(helpText(null).includes("codaryn changes"));
  });
});
