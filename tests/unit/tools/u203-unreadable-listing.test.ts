/**
 * U-203 (P1 bundle A, A-3; R-3, R-4): search_files and inspect_files leave out what is under the
 * run's unreadable paths, names included, and a text search never reads such a file (also through a
 * link). `withheld` says an unreadable path lies in the searched folder; it follows the policy's
 * entries alone, so an empty or missing unreadable folder gives the same answer. Without the option
 * the results are as before. The canary is made at run time and appears in no source file.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import type { RawToolOutcome, RawWorkflowToolOutcome, Workspace } from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createFakePrivacy } from "./doubles.js";

const never = new AbortController().signal;
const CANARY = `cnry${randomBytes(6).toString("hex")}`;
let base: string;
let workspace: Workspace;

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u203t-"));
  const root = path.join(base, "root");
  for (const dir of ["data/sub", "docs"]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "people.csv"), `name,city\n${CANARY},Seoul\n`);
  fs.writeFileSync(path.join(root, "data", "sub", "more.csv"), `${CANARY}\n`);
  fs.writeFileSync(path.join(root, "docs", "readme.md"), `about ${CANARY.slice(0, 4)} things\n`);
  try {
    fs.symlinkSync(path.join(root, "data"), path.join(root, "alias"), "junction");
  } catch {
    // without junctions the link case simply has no link to follow
  }
  workspace = await createWorkspace({ root });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const runner = (unreadablePaths?: readonly string[]) =>
  createToolRunner({ workspace, privacy: createFakePrivacy(), ...(unreadablePaths === undefined ? {} : { unreadablePaths }) });

async function search(args: Record<string, unknown>, unreadablePaths?: readonly string[]): Promise<RawToolOutcome> {
  return runner(unreadablePaths).execute({ id: "c1", name: "search_files", args } as never, never);
}
async function inspect(args: Record<string, unknown>, unreadablePaths?: readonly string[]): Promise<RawWorkflowToolOutcome> {
  const tools = runner(unreadablePaths);
  assert.ok(tools.executeWorkflowTool !== undefined);
  return tools.executeWorkflowTool({ id: "c1", name: "inspect_files", args } as never, never);
}
const text = (value: unknown): string => JSON.stringify(value);

describe("U-203: search_files leaves unreadable paths out", () => {
  test("without the option: as before (the control)", async () => {
    const outcome = await search({ path: ".", text: CANARY });
    assert.ok(outcome.ok && text(outcome.payload).includes("data/people.csv"));
    assert.equal(outcome.ok && Object.hasOwn(outcome.payload, "withheld"), false);
  });

  test("a text search from the root finds nothing under data, says withheld, and no canary is in the result", async () => {
    const outcome = await search({ path: ".", text: CANARY.slice(0, 4) }, ["data"]);
    assert.ok(outcome.ok, text(outcome));
    if (!outcome.ok) return;
    const result = text(outcome.payload);
    assert.equal(result.includes("data/") || result.includes("alias/") || result.includes(CANARY), false, result);
    assert.ok(result.includes("docs/readme.md"), "the readable file is still found");
    assert.equal((outcome.payload as { withheld?: true }).withheld, true);
  });

  test("a name search does not show names under data either", async () => {
    const outcome = await search({ path: ".", nameContains: "people" }, ["data"]);
    assert.ok(outcome.ok && !text(outcome.payload).includes("people"));
  });

  test("withheld follows the entries alone: an unreadable folder that does not exist says it too; one outside the folder does not", async () => {
    const missing = await search({ path: ".", nameContains: "readme" }, ["secret"]);
    assert.ok(missing.ok && (missing.payload as { withheld?: true }).withheld === true);
    const elsewhere = await search({ path: "docs", nameContains: "readme" }, ["data"]);
    assert.ok(elsewhere.ok && !Object.hasOwn(elsewhere.payload, "withheld"));
  });
});

describe("U-203: inspect_files leaves unreadable paths out", () => {
  test("without the option: as before (the control)", async () => {
    const outcome = await inspect({ path: "." });
    assert.ok(outcome.ok && text(outcome.payload).includes("data/people.csv"));
  });

  test("from the root: no entry under data, no hash of one, and withheld", async () => {
    const outcome = await inspect({ path: ".", hash: true }, ["data"]);
    assert.ok(outcome.ok, text(outcome));
    if (!outcome.ok || !("entries" in outcome.payload) || !("hashesIncomplete" in outcome.payload)) return;
    const paths = outcome.payload.entries.map((entry) => entry.path);
    assert.equal(paths.some((one) => one === "data" || one.startsWith("data/")), false, paths.join(","));
    assert.ok(paths.includes("docs/readme.md"));
    assert.equal((outcome.payload as { withheld?: true }).withheld, true);
    assert.equal(outcome.payload.next, null);
  });
});
