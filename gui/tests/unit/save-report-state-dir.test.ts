/** Saving a report cannot replace Codaryn's records, including through a directory link. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { isCodarynStatePath } from "../../src/main/save-file.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { saveReportButton } from "../../src/renderer/report/report-screen.js";
import { IPC_CHANNELS, createIpc } from "./gsec-ipc-harness.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN = "20261112T010203Z-0000abcd", REPORT = "# synthetic saved report\n", ORIGINAL = "synthetic original record\n";

async function fixture(t: TestContext) {
  const base = await fs.realpath(tmpdir()), root = await fs.mkdtemp(path.join(base, "codaryn-report-state-"));
  t.after(async () => {
    const relative = path.relative(base, root);
    assert.ok(relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    assert.equal(await fs.realpath(root), root);
    assert.equal((await fs.lstat(root)).isSymbolicLink(), false);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const ipc = await createIpc(), workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const opened = await ipc.deps.workspaces.open(workspace);
  assert.ok(opened.ok);
  ipc.answer = call => ({ v: 1, id: 0, ok: true, value: call === "reportMarkdown" ? { ok: true, text: REPORT } : { ok: false, code: "synthetic_unused" } });
  const save = async (target: string | null): Promise<unknown> => {
    Object.assign(ipc.deps, { chooseSavePath: async () => target });
    return ipc.call(IPC_CHANNELS.saveReport, [{ workspace: opened.handle, runId: RUN }]);
  };
  return { ipc, root, workspace, save };
}

const guarded = ["workspace records", "uppercase records", "other folder records", "linked records", "linked nested records", "records filename", "records named outward link"] as const;
for (const scenario of guarded) test(`save state dir: refuses ${scenario} before touching the selected file`, async t => {
  const { root, workspace, save } = await fixture(t);
  let target: string;
  if (scenario === "workspace records") target = path.join(workspace, ".codaryn", "runs", RUN, "journal.jsonl");
  else if (scenario === "uppercase records") target = path.join(workspace, ".CODARYN", "runs", RUN, "result.json");
  else if (scenario === "other folder records") target = path.join(root, "other", ".codaryn", "runs", RUN, "result.json");
  else if (scenario === "records filename") target = path.join(root, "ordinary", ".codaryn");
  else {
    const actual = scenario === "records named outward link" ? path.join(root, "ordinary") : path.join(workspace, ".codaryn", ...(scenario === "linked nested records" ? ["runs", RUN] : []));
    await fs.mkdir(actual, { recursive: true });
    const link = path.join(root, scenario === "records named outward link" ? ".codaryn" : "shortcut");
    await fs.symlink(actual, link, process.platform === "win32" ? "junction" : "dir");
    assert.ok((await fs.lstat(link)).isSymbolicLink(), "the fixture really uses a directory link");
    target = path.join(link, "report.md");
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, ORIGINAL);
  const before = await fs.readdir(path.dirname(target)), reply = await save(target), content = await fs.readFile(target, "utf8");
  const blocked = scenario !== "uppercase records" || process.platform === "win32";
  t.diagnostic(JSON.stringify({ scenario, blocked, reply, overwritten: content === REPORT }));
  assert.deepEqual(reply, blocked ? { ok: false, code: "save_state_dir" } : { ok: true, name: path.basename(target) });
  assert.equal(content, blocked ? ORIGINAL : REPORT);
  assert.deepEqual(await fs.readdir(path.dirname(target)), before, "no temporary file is left or added on refusal");
});

for (const location of ["workspace ordinary", "outside workspace", "similar component"] as const) test(`save state dir: still writes ${location}`, async t => {
  const { root, workspace, save } = await fixture(t);
  const parent = location === "workspace ordinary" ? path.join(workspace, "notes") : location === "outside workspace" ? path.join(root, "outside") : path.join(root, ".codaryn-backup", "x.codaryn");
  await fs.mkdir(parent, { recursive: true });
  const target = path.join(parent, "report.codaryn.md");
  await fs.writeFile(target, ORIGINAL);
  assert.deepEqual(await save(target), { ok: true, name: path.basename(target) });
  assert.equal(await fs.readFile(target, "utf8"), REPORT);
  assert.deepEqual(await fs.readdir(parent), [path.basename(target)]);
});

test("save state dir: an unresolved parent keeps save_failed", async t => {
  const { root, save } = await fixture(t), target = path.join(root, "missing", "report.md");
  assert.deepEqual(await save(target), { ok: false, code: "save_failed" });
  await assert.rejects(fs.stat(path.dirname(target)), { code: "ENOENT" });
});

test("save state dir: cancelling the dialog keeps not_saved", async t => {
  const { save } = await fixture(t);
  assert.deepEqual(await save(null), { ok: false, code: "not_saved" });
});

test("save state dir: a host failure does not open the save dialog", async t => {
  const { ipc } = await fixture(t);
  let dialogs = 0;
  Object.assign(ipc.deps, { chooseSavePath: async () => { dialogs++; return null; } });
  ipc.answer = () => ({ v: 1, id: 0, ok: false, error: { code: "synthetic_failure", message: "synthetic" } });
  const opened = await ipc.openWorkspace();
  assert.deepEqual(await ipc.call(IPC_CHANNELS.saveReport, [{ workspace: opened.handle, runId: RUN }]), { ok: false, code: "synthetic_failure" });
  assert.equal(dialogs, 0);
});

test("save state dir: component matching is exact and follows platform case and separators", () => {
  for (const file of ["C:\\work\\.codaryn\\runs\\report.md", "C:/work/.CODARYN/runs/report.md", "C:/work/ordinary/.codaryn", "C:/work/.codaryn/../report.md"]) assert.equal(isCodarynStatePath(file, "win32"), true, file);
  for (const file of ["C:/work/.codaryn-backup/report.md", "C:/work/normal/report.codaryn.md", "C:/work/prefix.codaryn/report.md"]) assert.equal(isCodarynStatePath(file, "win32"), false, file);
  assert.equal(isCodarynStatePath("/work/.codaryn/report.md", "linux"), true);
  assert.equal(isCodarynStatePath("/work/.CODARYN/report.md", "linux"), false);
  assert.equal(isCodarynStatePath("/work/x\\.codaryn/report.md", "linux"), false, "a backslash is a POSIX filename character");
});

test("save state dir: an unresolved state parent is save_failed before component rejection", async t => {
  const { root, save } = await fixture(t);
  assert.deepEqual(await save(path.join(root, ".codaryn", "missing", "report.md")), { ok: false, code: "save_failed" });
});

for (const language of ["en", "ko"] as const) test(`save state dir: the report button shows the ${language} error text`, async t => {
  const restore = installFakeDom(); t.after(restore);
  const api = { saveReport: async () => ({ ok: false, code: "save_state_dir" }) } as unknown as CodarynApi;
  const root = new FakeElement("div");
  root.append(...saveReportButton(textsFor(language), api, { handle: "a".repeat(32), name: "synthetic" }, RUN, "state-save") as unknown as FakeElement[]);
  const button = root.findAll(e => e.getAttribute("id") === "state-save")[0], status = root.findAll(e => e.getAttribute("id") === "state-save-status")[0];
  assert.ok(button && status); button.click(); await settle();
  const expected = language === "en" ? "A report cannot be saved inside a Codaryn records folder (.codaryn). Choose another place." : "Codaryn 기록 폴더(.codaryn) 안에는 저장할 수 없습니다. 다른 위치를 고르세요.";
  assert.ok(status.textContent.includes(expected));
  assert.equal(status.getAttribute("data-saved"), "save_state_dir");
});
