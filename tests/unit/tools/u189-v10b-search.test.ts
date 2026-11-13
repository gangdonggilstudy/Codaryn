/**
 * U-189 after Codex V-10b (verify-V10b-u189.md, search-omission.mjs): search_files' text search read
 * each listed file with the guarded read; a file whose read saw its folder change on every try
 * (io_error) was skipped in silence, so a text that is there came back as "no result". Now such a
 * skip marks the result `truncated` (not complete). The tool definition and the payload's fields do
 * not change. Files that are not text keep being passed over without it.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import type { SearchFilesPayload } from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { nodeFileLayer } from "../../../src/workspace/file-layer.js";
import type { FileLayer } from "../../../src/workspace/file-layer.js";
import { GUARD_ATTEMPTS } from "../../../src/workspace/guard.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createWorkspaceWithFileLayer } from "../../../src/workspace/workspace.js";
import { createFakePrivacy } from "./doubles.js";

const never = new AbortController().signal;
let base = "";
let root = "";

before(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u189-v10b-")));
  root = path.join(base, "root");
  fs.mkdirSync(path.join(root, "parent"), { recursive: true });
  fs.writeFileSync(path.join(root, "parent", "a.txt"), "inside needle\n");
  fs.writeFileSync(path.join(root, "parent", "b.bin"), Buffer.from([0x6e, 0x00, 0x65]));
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function search(workspace: Parameters<typeof createToolRunner>[0]["workspace"]): Promise<SearchFilesPayload> {
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy() });
  const outcome = await tools.execute({ id: "c1", name: "search_files", args: { path: "parent", text: "needle" } }, never);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  return outcome.payload as unknown as SearchFilesPayload;
}

test("V-10b: a file whose read saw its folder change on every try makes the search result incomplete, not empty and complete", async () => {
  const leaf = path.join(root, "parent", "a.txt");
  let opens = 0;
  // Codex's order: after each open of a.txt an ordinary sibling file is made and removed (the folder changes).
  const layer: FileLayer = {
    ...nodeFileLayer,
    openRead: async (target) => {
      const handle = await nodeFileLayer.openRead(target);
      if (target === leaf) {
        opens += 1;
        await sleep(5);
        const sibling = path.join(root, "parent", "ordinary-sibling.tmp");
        fs.writeFileSync(sibling, "x");
        fs.unlinkSync(sibling);
      }
      return handle;
    },
  };
  const payload = await search(await createWorkspaceWithFileLayer({ root }, layer));
  // U-213: as many tries as the guard makes (six since ne-verify's measurement).
  assert.equal(opens, GUARD_ATTEMPTS, "tried every time the guard tries");
  assert.deepEqual(payload.entries, []);
  assert.equal(payload.truncated, true, "the result says it is not complete");
});

test("V-10b: without the change the text is found and the result is complete; a binary file is passed over as before", async () => {
  const payload = await search(await createWorkspace({ root }));
  assert.deepEqual(payload.entries.map((entry) => entry.path), ["parent/a.txt"]);
  assert.equal(payload.truncated, false);
});
