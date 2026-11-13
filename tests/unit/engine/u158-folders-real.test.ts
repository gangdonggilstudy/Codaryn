/**
 * U-158 with the real parts (only the verifiers and the journal are stand-ins): tools' plan executor
 * and verify's inventory checker in a temporary workspace. An apply that moves every file out of
 * photos/2025 tells two folders left without files (photos/2025 and photos), and the folders are
 * still there; the real inventory gives `/` separated paths on every platform, so the count holds on
 * Windows too.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { planActionShown } from "../../../src/contracts/index.js";
import type { ApplyDeps, MaskedPlanAction, MaskedText, PolicyConfig, ResolvedPlanAction, StoredPlanAction, Workspace } from "../../../src/contracts/index.js";
import { applyPlan } from "../../../src/engine/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { createPlanExecutor, discardedRootOf } from "../../../src/tools/index.js";
import { createInventoryChecker } from "../../../src/verify/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { FakeClock, FakeVerifiers } from "./fakes.js";

const RUN = "20261113T060100Z-0000bbbb";
const PLAN_RUN = "20261113T060000Z-0000aaaa";
const sha = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

let base = "";
let workspace: Workspace;
before(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u158-")));
  const root = path.join(base, "ws");
  for (const [relative, text] of Object.entries({ "photos/2025/a.jpg": "a", "photos/2025/b.jpg": "b", "notes.txt": "n", "docs/keep.md": "k", "docs/move.md": "m" })) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), text);
  }
  fs.mkdirSync(path.join(root, ".codaryn", "runs"), { recursive: true });
  workspace = await createWorkspace({ root });
});
after(() => fs.rmSync(base, { recursive: true, force: true }));

function stored(action: ResolvedPlanAction): StoredPlanAction {
  const masked: MaskedPlanAction =
    action.kind === "move"
      ? { kind: "move", from: action.from as MaskedText, to: action.to as MaskedText, sha256: action.sha256 }
      : { kind: "discard", path: action.path as MaskedText, sha256: action.sha256 };
  return { ...action, shown: planActionShown(masked) } as StoredPlanAction;
}

describe("U-158: the count with the real executor and inventory", () => {
  test("photos/2025 emptied (and photos with it), docs kept: 2, and the folders stay", async () => {
    const actions: ResolvedPlanAction[] = [
      { kind: "move", from: "photos/2025/a.jpg", to: "sorted/a.jpg", sha256: sha("a") },
      { kind: "move", from: "photos/2025/b.jpg", to: "sorted/b.jpg", sha256: sha("b") },
      { kind: "move", from: "docs/move.md", to: "sorted/move.md", sha256: sha("m") },
    ];
    const config: PolicyConfig = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move", "discard"] };
    const deps: ApplyDeps = {
      plan: { schemaVersion: 1, kind: "plan", runId: PLAN_RUN, actions: actions.map(stored) },
      planRunId: PLAN_RUN,
      digest: "d".repeat(64),
      approval: "cli-flag",
      runId: RUN,
      taskId: "tidy",
      maxDurationMs: 60_000,
      verifierConfigs: [],
      executor: createPlanExecutor({ workspace, workspaceRoot: workspace.root, runId: RUN }),
      policy: createPolicyGate({ config, workspace }),
      planActions: ["move", "discard"],
      discardedRoot: discardedRootOf(workspace.root, RUN),
      privacy: createPrivacyGateway({ secrets: [] }),
      verifiers: new FakeVerifiers(),
      inventory: createInventoryChecker({ workspaceRoot: workspace.root }),
      journal: { append: async () => undefined, close: async () => undefined },
      clock: new FakeClock(),
      signal: new AbortController().signal,
      markApplied: async () => "marked",
    };
    const result = await applyPlan(deps);
    assert.deepEqual([result.status, result.reason], ["done", "verified"], JSON.stringify(result.verifiers));
    assert.equal(result.foldersLeftEmpty, 2);
    assert.ok(fs.statSync(path.join(workspace.root, "photos", "2025")).isDirectory(), "the emptied folder stays");
    assert.deepEqual(fs.readdirSync(path.join(workspace.root, "photos", "2025")), []);
    assert.deepEqual(fs.readdirSync(path.join(workspace.root, "docs")), ["keep.md"]);
  });
});
