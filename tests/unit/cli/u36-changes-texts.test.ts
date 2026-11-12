/**
 * Unit U-36 (UXM-7 ③, survey docs/reviews/2026-11-13-u19-korean-gaps-survey.md 3 D), the `changes`
 * part: the text of `codaryn changes` comes from the message catalog (the contract's ids, U-36
 * contract 1ca962e), so a person reads it in their language. Pinned:
 * - English: without a catalog (the fallback) and with the English catalog, the text is the one
 *   before U-36 character for character, except the no-text line, which loses "(DR-29)".
 * - `changes --json` is not changed.
 * - With a catalog every piece of text is the catalog's: no fixed English word is left.
 * - A run with a records-changed mark (ChangesOutput.recordsChanged, U-43) says so with the catalog's
 *   `changes.records_changed`, which nothing used before.
 * Reproduced first (todo until the renderer takes the catalog, and until unit/U-36-nb-i18n gives the
 * texts). Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AppCallOutcome, ChangesOutput, ChangesRequest } from "../../../src/app/index.js";
import type { MessageCatalog } from "../../../src/contracts/index.js";
import { renderChanges, runChanges } from "../../../src/cli/changes.js";
import type { ChangesEnvironment } from "../../../src/cli/changes.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const TODO = { todo: "U-36: renderChanges does not take the message catalog yet" };
const TEXTS_TODO = { todo: "U-36: wait for unit/U-36-nb-i18n's texts of the changes ids" };

const RUN = "20261113T010203Z-0123abcd";
const BASE = { schemaVersion: 1, kind: "changes", runId: RUN, exitCode: 0, masking: "current_secrets" } as const;
const BIG = Array.from({ length: 203 }, (_, i) => `line ${i}`).join("\n") + "\n";

/** Every line kind: created, changed, missing, unreadable, masking_unverified, no difference, a cut side. */
const ALL: ChangesOutput = {
  ...BASE,
  files: [
    { path: "new.md" as never, created: true, state: "as_run_left", before: null, after: "a\nb\n" as never, unavailable: null },
    { path: "doc.md" as never, created: false, state: "changed_since_run", before: "x\ny\n" as never, after: "x\nY\n" as never, unavailable: null },
    { path: "gone.md" as never, created: false, state: "missing", before: "z\n" as never, after: null, unavailable: null },
    { path: "odd.bin" as never, created: false, state: "unknown", before: null, after: null, unavailable: "unreadable" },
    { path: "secret.md" as never, created: false, state: "as_run_left", before: null, after: null, unavailable: "masking_unverified" },
    { path: "same.md" as never, created: false, state: "as_run_left", before: "s\n" as never, after: "s\n" as never, unavailable: null },
    { path: "big.md" as never, created: true, state: "as_run_left", before: null, after: BIG as never, unavailable: null },
  ],
};
const NONE: ChangesOutput = { ...BASE, files: [] };
const APPLY: ChangesOutput = { ...BASE, files: [], applyRun: { planRunId: "20261113T000000Z-89abcdef" as never, actions: 2 } };
const MARKED: ChangesOutput = { ...ALL, files: [ALL.files[4]!], recordsChanged: true };

const HEADING = `changes of run ${RUN}, masked with the secrets registered now (not the run's own masking)`;
/** The English text before U-36 (main 1e54ca9), the no-text line without "(DR-29)". */
const ALL_EN = [
  HEADING,
  "no text for some files: a file's text is shown only when the secrets registered now mask it as the run did and the file is as the run left it; the others have their path and state only",
  "== new.md: created by the run; as the run left it",
  "@@ -1,0 +1,2 @@",
  "+ a",
  "+ b",
  "== doc.md: changed by the run; changed again since the run",
  "@@ -2,1 +2,1 @@",
  "- y",
  "+ Y",
  "== gone.md: changed by the run; no longer exists",
  "@@ -1,1 +1,0 @@",
  "- z",
  "== odd.bin: changed by the run; could not be read now",
  "   the text is not shown (unreadable)",
  "== secret.md: changed by the run; as the run left it",
  "   the text is not shown (masking_unverified)",
  "== same.md: changed by the run; as the run left it",
  "   no difference to the original",
  "== big.md: created by the run; as the run left it",
  "@@ -1,0 +1,203 @@",
  ...Array.from({ length: 200 }, (_, i) => `+ line ${i}`),
  "+ ... 3 more lines",
  "",
].join("\n");
const NONE_EN = `${HEADING}\nthe run changed no file\n`;
const APPLY_EN = `${HEADING}\nthe run is an apply run: it applied 2 action(s) of the plan of run 20261113T000000Z-89abcdef (moves and discards, not file writes); codaryn report lists them\n`;

/** Every fixed English word of the text before U-36. */
const ENGLISH = [
  "changes of run",
  "masked with the secrets",
  "no text for some files",
  "created by the run",
  "changed by the run",
  "as the run left it",
  "changed again since the run",
  "no longer exists",
  "could not be read now",
  "the text is not shown",
  "no difference to the original",
  "more lines",
  "the run changed no file",
  "the run is an apply run",
  "records-changed mark",
];

/** A catalog whose every text names its id (and its parameters), so a text not from it shows. */
const NAMING = {
  language: "en",
  format: (id: string, params?: Readonly<Record<string, unknown>>) => `‹${id}${params === undefined ? "" : ` ${JSON.stringify(params)}`}›`,
} as unknown as MessageCatalog;

/** renderChanges with a catalog, whatever its declared parameters are now. */
const render = (output: ChangesOutput, messages?: MessageCatalog): string => (renderChanges as (output: ChangesOutput, messages?: MessageCatalog) => string)(output, messages);

describe("U-36: changes' English text is as before", () => {
  test("without a catalog: as before, the no-text line without (DR-29)", TODO, () => {
    assert.equal(render(ALL), ALL_EN);
  });

  test("without a catalog: no file changed, and an apply run, as before", () => {
    assert.equal(render(NONE), NONE_EN);
    assert.equal(render(APPLY), APPLY_EN);
  });

  test("with the English catalog: the same text as without one", { ...TODO, ...TEXTS_TODO }, () => {
    const en = createMessageCatalog("en");
    assert.equal(render(ALL, en), ALL_EN);
    assert.equal(render(NONE, en), NONE_EN);
    assert.equal(render(APPLY, en), APPLY_EN);
  });

  test("changes --json is not changed", async () => {
    const outcome = await runChanges({
      argv: ["changes", "--task", "t.json", "--run", RUN, "--json"],
      env: {},
      app: { changes: async (_request: ChangesRequest): Promise<AppCallOutcome<ChangesOutput>> => ({ ok: true, output: ALL }) },
    });
    assert.ok("text" in outcome);
    assert.equal(outcome.text, `${JSON.stringify(ALL)}\n`);
  });
});

describe("U-36: with a catalog every piece of changes' text is the catalog's", () => {
  test("each line: the catalog's ids, the masked paths, the region, the reason codes", TODO, () => {
    const shown = render(ALL, NAMING);
    for (const word of ENGLISH) assert.equal(shown.includes(word), false, `fixed English left: ${word}`);
    const lines = shown.split("\n");
    assert.equal(lines[0], `‹changes.heading {"runId":"${RUN}"}›`);
    assert.equal(lines[1], "‹changes.no_text_note›");
    assert.ok(lines.includes("== gone.md: ‹changes.file.changed›; ‹changes.state.missing›"));
    assert.ok(lines.includes("== new.md: ‹changes.file.created›; ‹changes.state.as_run_left›"));
    assert.ok(lines.includes("   ‹changes.unavailable.unreadable› (unreadable)"));
    assert.ok(lines.includes("   ‹changes.no_difference›"));
    assert.ok(lines.includes('+ ‹changes.more_lines {"count":3}›'));
    assert.equal(render(NONE, NAMING).split("\n")[1], "‹changes.none›");
    assert.equal(render(APPLY, NAMING).split("\n")[1], '‹changes.apply_run {"count":2,"runId":"20261113T000000Z-89abcdef"}›');
  });

  test("runChanges gives the text its catalog", TODO, async () => {
    const outcome = await runChanges({
      argv: ["changes", "--task", "t.json", "--run", RUN],
      env: {},
      app: { changes: async (): Promise<AppCallOutcome<ChangesOutput>> => ({ ok: true, output: NONE }) },
      messages: NAMING,
    } as ChangesEnvironment);
    assert.ok("text" in outcome);
    assert.equal(outcome.text, `‹changes.heading {"runId":"${RUN}"}›\n‹changes.none›\n`);
  });

  test("with the Korean catalog: no fixed English word", { ...TODO, ...TEXTS_TODO }, () => {
    const shown = [ALL, NONE, APPLY, MARKED].map((output) => render(output, createMessageCatalog("ko"))).join("\n");
    for (const word of ENGLISH) assert.equal(shown.includes(word), false, `English left: ${word}`);
  });
});

describe("U-36: a run with a records-changed mark says so (changes.records_changed)", () => {
  test("after the heading, before the no-text line; only for a marked run", TODO, () => {
    const lines = render(MARKED, NAMING).split("\n");
    assert.deepEqual(lines.slice(0, 3), [`‹changes.heading {"runId":"${RUN}"}›`, "‹changes.records_changed›", "‹changes.no_text_note›"]);
    assert.equal(render(ALL, NAMING).includes("changes.records_changed"), false);
    assert.equal(render(MARKED).split("\n")[1], "This run has a records-changed mark, so no file text is shown; only paths and states.");
  });
});
