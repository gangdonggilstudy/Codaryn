/**
 * GU-1/GU-2 smoke test: the real Electron app with the real engine host (DR-26). Started by
 * scripts/build/smoke.mjs as `electron build/tests/smoke/smoke.js <first workspace>` with the
 * second workspace in CODARYN_SMOKE_SECOND; never part of the product entry (main.ts).
 *
 * It sees the first workspace opened from the command line, opens the second as a second start
 * of the app would, walks the read-only file tree, the recent list and the checks screen, probes
 * the renderer's isolation and blocked requests (loopback addresses only), counts sockets and
 * outside connections of the app's processes, writes what it saw to build/smoke-result.json and
 * quits.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { startGui } from "../../src/main/app.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const RESULT = join(GUI, "build", "smoke-result.json");
const STATE = join(GUI, "build", "smoke-state", "gui-state.json");
const SECOND = process.env["CODARYN_SMOKE_SECOND"] ?? "";
/** U-206: a run plan's run folder that smoke.mjs wrote as the store does, copied into SECOND before step 8. */
const RUN_PLAN = process.env["CODARYN_SMOKE_RUN_PLAN"] ?? "";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** R29-L1: the model requests the fake API has received so far (the smoke script's count file); -1 when unread. */
const API_COUNT = process.env["CODARYN_SMOKE_API_COUNT"] ?? "";
function messagesReceived(): number {
  try {
    const value = (JSON.parse(readFileSync(API_COUNT, "utf8")) as { messages?: unknown }).messages;
    return typeof value === "number" ? value : -1;
  } catch {
    return -1;
  }
}
/** U-40 (DR-52): the masking counts the run's result.json recorded (the CLI's own record); null when unread. */
function recordedMasking(runId: string): unknown {
  try {
    return (JSON.parse(readFileSync(join(SECOND, ".codaryn", "runs", runId, "result.json"), "utf8")) as { masking?: unknown }).masking ?? null;
  } catch {
    return null;
  }
}
/**
 * U-54 (R-65 L-1): what the run's journal recorded of its call codaryn-call-1 (the engine's first
 * replaced id): whether its decision allowed it and whether its result was ok; null when unread.
 */
function replacedCall(runId: string): { decision: boolean | null; result: boolean | null } | null {
  try {
    const records = readFileSync(join(SECOND, ".codaryn", "runs", runId, "journal.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { type?: string; callId?: string; allowed?: boolean; result?: { callId?: string; ok?: boolean } });
    const decision = records.find((record) => record.type === "tool_decision" && record.callId === "codaryn-call-1");
    const result = records.find((record) => record.type === "tool_result" && record.result?.callId === "codaryn-call-1");
    return { decision: decision?.allowed ?? null, result: result?.result?.ok ?? null };
  } catch {
    return null;
  }
}
/** Waits until the fake API has received more model requests than `before`; false after `ms`. */
async function requestArrived(before: number, ms = 60_000): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 50) {
    if (before >= 0 && messagesReceived() > before) return true;
    await sleep(50);
  }
  return false;
}

interface Endpoint {
  readonly proto: string;
  readonly address: string;
  readonly port: number;
  readonly pid: number;
}

/**
 * Listening TCP sockets, bound UDP endpoints and TCP connections to anything but the machine
 * itself, owned by these processes (Windows PowerShell).
 */
function sockets(pids: readonly number[]): { tcp: number; udp: number; outside: number; endpoints: Endpoint[] } | string {
  if (process.platform !== "win32") return "not measured on this platform";
  // R-10 L-5: a failed measurement is a failure, never zero sockets. The cmdlets stop on any error,
  // and the whole system must show some TCP and UDP endpoints, or the reading is not trusted.
  const powershell =
    process.env["CODARYN_SMOKE_POWERSHELL"] ?? join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$p = @(${pids.join(",")})`,
    "$local = @('127.0.0.1', '::1', '0.0.0.0', '::')",
    "try { $allTcp = @(Get-NetTCPConnection); $allUdp = @(Get-NetUDPEndpoint) } catch { Write-Output 'measurement-failed'; exit 0 }",
    "if ($allTcp.Count -eq 0 -or $allUdp.Count -eq 0) { Write-Output 'measurement-failed'; exit 0 }",
    "$t = @($allTcp | Where-Object { ($_.State -eq 'Listen') -and ($p -contains $_.OwningProcess) } | ForEach-Object { 'tcp ' + $_.LocalAddress + ' ' + $_.LocalPort + ' ' + $_.OwningProcess })",
    "$u = @($allUdp | Where-Object { $p -contains $_.OwningProcess } | ForEach-Object { 'udp ' + $_.LocalAddress + ' ' + $_.LocalPort + ' ' + $_.OwningProcess })",
    "$o = @($allTcp | Where-Object { ($p -contains $_.OwningProcess) -and ($_.State -ne 'Listen') -and -not ($local -contains $_.RemoteAddress) } | ForEach-Object { 'out ' + $_.RemoteAddress + ' ' + $_.RemotePort + ' ' + $_.OwningProcess })",
    "Write-Output 'measured'",
    "($t + $u + $o) -join \"`n\"",
  ].join("; ");
  let out: string;
  try {
    out = execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return "measurement failed";
  }
  if (!out.startsWith("measured")) return "measurement failed";
  const endpoints = out
    .replace(/^measured/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [proto, address, port, pid] = line.trim().split(" ");
      return { proto: proto ?? "?", address: address ?? "?", port: Number(port), pid: Number(pid) };
    });
  const count = (proto: string): number => endpoints.filter((endpoint) => endpoint.proto === proto).length;
  return { tcp: count("tcp"), udp: count("udp"), outside: count("out"), endpoints };
}

const results: Record<string, unknown> = {};
/** U-5: the reports saved and the end notifications sent, as the main process gave them. */
const SAVED_REPORTS = join(GUI, "build", "smoke-report");
const savedReports: string[] = [];
const notices: { readonly title: string; readonly body: string }[] = [];
/** U-63: the files the OS open dialog would choose, in order (null: closed without a file). */
const openAnswers: (string | null)[] = [];
/** U-62: what the app would have put on the clipboard (the OS clipboard is never touched by the test). */
const copied: string[] = [];
/** U-124: the permission questions the main process asked (the test answers for the OS dialog), and its answers. */
const questionsSeen: { id: string; tool: string; permission: string; subject: string; argumentCount: number }[] = [];
const permissionAnswers: ("allow_once" | "deny" | "dismissed")[] = [];
/**
 * U-123, R-111b M-1: run starts whose button was off when the new task screen was ready, before the test
 * waited for it (pinned empty: after this window's own run the button is on at once, R-111b a).
 */
const startsBlocked: unknown[] = [];
/**
 * U-178: a run id as the window shows it. A result wait's "timeout", or the "error:<code>" a start or
 * an end the window showed instead, is not one: it builds no path, and the steps that need that run
 * are left out (their checks fail; the others go on).
 */
const RUN_ID_SHAPE = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const isRunIdValue = (value: unknown): value is string => typeof value === "string" && RUN_ID_SHAPE.test(value);
/** U-178: each result wait that got no run id: the step, what came instead, and why (start blocks, the lock file, the window). */
const stepFailures: unknown[] = [];
/** U-178: once a result wait has failed, the later ones wait at most this long (the app may be stuck; the rest is still checked). */
const AFTER_FAILURE_MS = 20_000;
/** U-178: no wait goes past this, so the result file is written before smoke.mjs stops the app (240 s after its start). */
const WAIT_DEADLINE = Date.now() + 210_000;
/** U-178: the workspace lock file as it is now (holder pid and run id), for a failed result wait. */
function lockNow(): unknown {
  const file = join(SECOND, ".codaryn", "lock.json");
  try {
    if (!existsSync(file)) return null;
    const lock = JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown; runId?: unknown };
    return { pid: lock.pid ?? null, runId: lock.runId ?? null };
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
}
/** U-66: the paths "show in folder" would select (recorded, not the OS file manager). */
const revealed: string[] = [];
const COPY_KEY_SHAPED = ["sk", "ant", "FAKE".repeat(10)].join("-");
let pretendInactive = false;
/** PM (a): the engine host's answer to "transport" (its mode and how many requests it refused). */
const transportOf = (response: { readonly ok: boolean; readonly value?: unknown; readonly error?: { readonly code: string } }): unknown => (response.ok ? response.value : response.error?.code);
/** The main process's OS dialogs this test answered, by id. */
const dialogs: string[] = [];
/** GU-6: answer the next widening dialog with "do not write". */
let refuseWidening = false;
/** DR-44: answer the next "also remove the records of runs not reverted?" dialog with "keep them". */
let keepNotReverted = false;
/** R47-I4: answer the next "also delete the discarded files?" dialog with "keep them". */
let keepDiscarded = false;

startGui({
  // R21-I-3: the engine host reaches this machine only (the loopback fake API); never a real API.
  loopbackOnly: true,
  guiRoot: GUI,
  userDataDir: join(GUI, "build", "smoke-profile"),
  stateFile: STATE,
  // U-5 (3.7): a report is "saved" under build/smoke-report instead of the OS save dialog.
  answerSaveDialog: async (name) => {
    mkdirSync(SAVED_REPORTS, { recursive: true });
    savedReports.push(name);
    return join(SAVED_REPORTS, name);
  },
  // U-5 (3.6): the OS end notifications, kept instead of shown.
  answerOpenDialog: async () => openAnswers.shift() ?? null,
  writeClipboard: (text) => {
    copied.push(text);
  },
  answerPermission: async (question) => {
    questionsSeen.push({ id: question.id, tool: question.tool, permission: question.permission, subject: question.subject, argumentCount: question.argumentCount });
    return permissionAnswers.shift() ?? "dismissed";
  },
  showItemInFolder: (path) => {
    revealed.push(path);
  },
  notify: (notice) => {
    notices.push(notice);
  },
  // The window counts as not active only while the first run ends (window.blur() is not reliable on Windows).
  windowActive: () => !pretendInactive,
  answerDialog: async (id) => {
    dialogs.push(id);
    if (id === "cleanup.notReverted.message" && keepNotReverted) {
      keepNotReverted = false;
      return 1;
    }
    if (id === "cleanup.discarded.message" && keepDiscarded) {
      keepDiscarded = false;
      return 1;
    }
    if (id === "widen.message" && refuseWidening) {
      refuseWidening = false;
      return 1;
    }
    return 0;
  },
  async afterLoad({ window, host, openFromOutside }) {
    try {
      const contents = window.webContents;
      const js = (code: string): Promise<unknown> => contents.executeJavaScript(code, true);
      const waitFor = async (code: string, ms = 60_000): Promise<unknown> => {
        // U-178: a wait ends by WAIT_DEADLINE (it still looks once), so what was seen is written.
        const budget = Math.min(ms, Math.max(100, WAIT_DEADLINE - Date.now()));
        for (let waited = 0; waited < budget; waited += 100) {
          const value = await js(code);
          if (value !== null && value !== undefined && value !== false) return value;
          await sleep(100);
        }
        return "timeout";
      };
      const treeRows = (): Promise<unknown> =>
        js(
          "[...document.querySelectorAll('.tree [data-key]')].map((li) => ({ kind: li.getAttribute('data-kind'), masked: li.getAttribute('data-masked'), level: li.getAttribute('aria-level'), expanded: li.getAttribute('aria-expanded'), text: li.textContent }))",
        );

      // 1. The workspace from the command line is open and its top level is shown.
      results["initialTree"] = await waitFor("document.querySelector('.tree')?.getAttribute('data-tree-ready') ?? null");
      results["initialWorkspace"] = await js("document.getElementById('status-workspace')?.textContent ?? null");
      results["initialRows"] = await treeRows();

      // 2. A second workspace, as a second start of the app with it on the command line opens it.
      const second = await openFromOutside(SECOND);
      results["secondOpened"] = second.ok;
      results["secondTree"] = await waitFor(
        `(() => { const t = document.querySelector('.tree'); return t?.getAttribute('data-tree-ready') === 'ok' && document.getElementById('status-workspace')?.textContent?.includes(${JSON.stringify(SECOND.split(/[\\/]/).pop())}) ? 'ok' : null; })()`,
      );
      results["secondRows"] = await treeRows();
      // R10b-L-2: a network folder from outside is refused untouched and stays out of the recent list.
      results["networkFolder"] = await openFromOutside("\\\\files.example.invalid\\share\\work");

      // 3. Open the folder "sub" by clicking it; its children appear one level deeper.
      await js("[...document.querySelectorAll('.tree [data-kind=\"dir\"]')].find((li) => li.textContent.trim().endsWith('sub'))?.click(); true");
      results["expanded"] = await waitFor("[...document.querySelectorAll('.tree [data-key]')].some((li) => li.getAttribute('aria-level') === '2' && li.textContent.includes('b.txt')) ? 'ok' : null", 20_000);
      // Keyboard: Home, then Down, then Left/Right keep the focus inside the tree.
      results["keyboard"] = await js(
        "(() => { const tree = document.querySelector('.tree'); const first = tree.querySelector('[tabindex=\"0\"]'); first.focus(); tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); const last = document.activeElement?.getAttribute('data-key'); tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); return { moved: last !== null && last !== document.activeElement?.getAttribute('data-key'), inTree: tree.contains(document.activeElement) }; })()",
      );
      results["treeText"] = await js("document.querySelector('.tree')?.textContent ?? ''");
      // U-103 (G-list, 3.3): the tree is the app layer's list. The key-shaped name comes masked without an
      // id; a plain entry's path is copied by its id (the main process resolves it), nothing else.
      results["treeCopyPath"] = await (async () => {
        const handleText = JSON.stringify(second.ok ? second.handle : "");
        type Listed = { ok: boolean; entries?: { id: string | null; name: string; masked: boolean }[] };
        const top = (await js(`window.codaryn.tree(${handleText}, null, 0)`)) as Listed;
        const idOf = (list: Listed, name: string): string => list.entries?.find((entry) => entry.name === name)?.id ?? "";
        const sub = (await js(`window.codaryn.tree(${handleText}, ${JSON.stringify(idOf(top, "sub"))}, 0)`)) as Listed;
        const copy = (workspace: string, node: string): Promise<unknown> => js(`window.codaryn.copyPath(${workspace}, ${JSON.stringify(node)}).then((r) => (r.ok ? "copied" : r.code))`);
        const before = copied.length;
        const result = {
          masked: top.entries?.filter((entry) => entry.masked).map((entry) => entry.id) ?? "none",
          top: await copy(handleText, idOf(top, "a.txt")),
          nested: await copy(handleText, idOf(sub, "b.txt")),
          unknown: await copy(handleText, "0".repeat(32)),
          pathString: await copy(handleText, "sub/b.txt"),
          otherWorkspace: await copy(JSON.stringify("f".repeat(32)), idOf(top, "a.txt")),
          button: await (async () => {
            await js("[...document.querySelectorAll('.tree [data-kind=\"file\"]')].find((li) => li.textContent.trim().endsWith('a.txt'))?.click(); true");
            await js("document.getElementById('tree-copy-path')?.click(); true");
            return waitFor("document.getElementById('tree-copy-status')?.getAttribute('data-copied') ?? null");
          })(),
          texts: [] as string[],
        };
        result.texts = copied.slice(before);
        return result;
      })();
      // U-174 (DR-72, 3.14): the text view. The files are made for this check and removed after it, so
      // the tree the later checks read is the one they expect.
      results["textView"] = await (async () => {
        const dir = join(SECOND, "texts");
        mkdirSync(dir, { recursive: true });
        // A key shape, written in parts so no key-shaped text sits in the source.
        const keyShaped = ["sk", "ant", "TEXT".repeat(10)].join("-");
        writeFileSync(join(dir, "plain.txt"), "line one\r\nline two\r\n");
        writeFileSync(join(dir, "key.txt"), `token = ${keyShaped}\n`);
        writeFileSync(join(dir, "big.txt"), "x".repeat(300_000));
        writeFileSync(join(dir, "binary.dat"), Buffer.from([0x41, 0x00, 0x42]));
        try {
          const handleText = JSON.stringify(second.ok ? second.handle : "");
          type Listed = { ok: boolean; entries?: { id: string | null; name: string }[] };
          const top = (await js(`window.codaryn.tree(${handleText}, null, 0)`)) as Listed;
          const textsId = top.entries?.find((entry) => entry.name === "texts")?.id ?? "";
          const listed = (await js(`window.codaryn.tree(${handleText}, ${JSON.stringify(textsId)}, 0)`)) as Listed;
          const idOf = (name: string): string => listed.entries?.find((entry) => entry.name === name)?.id ?? "";
          type Reply = { ok: boolean; opened?: boolean; text?: string; masked?: boolean; editable?: boolean; readOnlyReasons?: string[]; lines?: number; reason?: string; code?: string };
          const open = async (node: string): Promise<Reply> => (await js(`window.codaryn.openText(${handleText}, ${JSON.stringify(node)})`)) as Reply;
          const plain = await open(idOf("plain.txt"));
          const key = await open(idOf("key.txt"));
          const statusOf = (reply: Reply): string => (reply.ok ? (reply.opened === false ? (reply.reason ?? "") : "opened") : (reply.code ?? ""));
          const ui = await (async () => {
            await js("[...document.querySelectorAll('.tree [data-kind=\"file\"]')].find((li) => li.textContent.trim().endsWith('a.txt'))?.click(); true");
            await js("document.getElementById('tree-open')?.click(); true");
            const ready = await waitFor("(() => { const r = document.getElementById('text')?.getAttribute('data-text-ready'); return r === 'opened' || r === 'not_opened' || r === 'error' ? r : null; })()");
            const area = (await js("(() => { const a = document.getElementById('text-content'); return a === null ? null : { value: a.value, readOnly: a.readOnly }; })()")) as { value: string; readOnly: boolean } | null;
            await js("document.getElementById('text-close')?.click(); true");
            const back = await js("document.getElementById('work')?.getAttribute('data-screen') ?? null");
            return { ready, value: area?.value ?? null, readOnly: area?.readOnly ?? null, back };
          })();
          // U-184 (DR-72, 3.14): saving, by the edit token and the text only.
          results["textEdit"] = await (async () => {
            type Saved = { ok: boolean; saved?: boolean; status?: string; textProblems?: string[]; editToken?: string; code?: string };
            const save = async (token: string, body: string): Promise<Saved> => (await js(`window.codaryn.saveText(${JSON.stringify(token)}, ${JSON.stringify(body)})`)) as Saved;
            const outcome = (reply: Saved): string => (reply.ok ? (reply.saved === true ? "saved" : (reply.status ?? "")) : (reply.code ?? ""));
            const asked = (): number => dialogs.filter((id) => id === "textSave.message").length;
            const askedBefore = asked();
            const opened = (await open(idOf("plain.txt"))) as Reply & { editToken?: string | null };
            const firstToken = opened.editToken ?? "";
            const first = await save(firstToken, "line one\nline 2\n");
            const disk = readFileSync(join(dir, "plain.txt"), "utf8");
            const second = await save(first.editToken ?? "", "line one\nline 3\n");
            const oldToken = await save(firstToken, "line one\nline 4\n");
            const before = readFileSync(join(dir, "plain.txt"), "utf8");
            const refused = await save(second.editToken ?? "", `line one\nsecret ${keyShaped}\n`);
            writeFileSync(join(dir, "plain.txt"), "changed elsewhere\r\n");
            const conflict = await save(second.editToken ?? "", "line one\nline 5\n");
            const unchangedOnDisk = readFileSync(join(dir, "plain.txt"), "utf8") === "changed elsewhere\r\n" && before === "line one\r\nline 3\r\n";
            const apiAsked = asked() - askedBefore;
            // The window: open a.txt, type, try to leave (asked, keep), save (a new opened file asks once more).
            const aBefore = readFileSync(join(SECOND, "a.txt"), "utf8");
            const ui = await (async () => {
              await js("[...document.querySelectorAll('.tree [data-kind=\"file\"]')].find((li) => li.textContent.trim().endsWith('a.txt'))?.click(); true");
              await js("document.getElementById('tree-open')?.click(); true");
              await waitFor("document.getElementById('text')?.getAttribute('data-editable') === 'true' ? 'ok' : null");
              await js("(() => { const a = document.getElementById('text-content'); a.value = 'alpha beta'; a.dispatchEvent(new Event('input')); return true; })()");
              const unsaved = await js("document.getElementById('text-save')?.hasAttribute('disabled') === false");
              await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
              const leaveAsked = await js("document.getElementById('text-leave')?.hasAttribute('hidden') === false");
              await js("document.getElementById('text-leave-keep')?.click(); true");
              const stayed = await js("document.getElementById('work')?.getAttribute('data-screen') ?? null");
              await js("document.getElementById('text-save')?.click(); true");
              const saved = await waitFor("document.querySelector('#text-result [data-save]')?.getAttribute('data-save') ?? null");
              const clean = await js("document.getElementById('text-save')?.hasAttribute('disabled') === true");
              return { unsaved, leaveAsked, stayed, saved, asked: asked() - askedBefore, disk: readFileSync(join(SECOND, "a.txt"), "utf8"), clean };
            })();
            // a.txt goes back to what the later checks expect.
            writeFileSync(join(SECOND, "a.txt"), aBefore);
            await js("document.getElementById('text-close')?.click(); true");
            return {
              editable: opened.editable,
              first: outcome(first),
              disk,
              second: outcome(second),
              asked: apiAsked,
              oldToken: outcome(oldToken),
              refused: { status: outcome(refused), problems: refused.textProblems ?? [] },
              conflict: outcome(conflict),
              unchangedOnDisk,
              ui,
            };
          })();
          return {
            plain: { opened: plain.opened, text: plain.text, masked: plain.masked, editable: plain.editable, reasons: plain.readOnlyReasons, lines: plain.lines },
            key: { opened: key.opened, masked: key.masked, editable: key.editable, firstReason: key.readOnlyReasons?.[0] ?? null, keyShown: (key.text ?? "").includes(keyShaped) },
            big: statusOf(await open(idOf("big.txt"))),
            binary: statusOf(await open(idOf("binary.dat"))),
            unknown: statusOf(await open("0".repeat(32))),
            pathString: statusOf((await js(`window.codaryn.openText(${handleText}, "texts/plain.txt")`)) as Reply),
            ui,
          };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      })();

      // U-67 (3.13, 10): the command palette, the shortcuts, F5 and the tree's first-letter jump.
      results["keys"] = await (async () => {
        const press = (target: string, key: string, ctrl = false, shift = false): Promise<unknown> =>
          js(`(() => { const t = ${target}; if (!t) return false; t.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, ctrlKey: ${ctrl}, shiftKey: ${shift}, bubbles: true, cancelable: true })); return true; })()`);
        const commandsShown = "[...document.querySelectorAll('#palette-list [data-command]')].map((li) => li.getAttribute('data-command'))";
        await press("document", "P", true, true);
        const opened = await js("document.getElementById('palette')?.hasAttribute('hidden') === false && document.activeElement?.id === 'palette-input'");
        const listed = await js(commandsShown);
        const cancel = await js("document.querySelector('#palette-list [data-command=\"cancel\"]')?.getAttribute('aria-disabled') ?? null");
        await js("(() => { const name = document.querySelector('#palette-list [data-command=\"checks\"] .palette-name')?.textContent ?? ''; const input = document.getElementById('palette-input'); input.value = name; input.dispatchEvent(new Event('input')); return true; })()");
        const filtered = await js(commandsShown);
        await press("document.getElementById('palette-input')", "Enter");
        const ran = await js("[document.getElementById('palette')?.hasAttribute('hidden'), document.getElementById('work')?.getAttribute('data-screen')]");
        await js("document.querySelector('[data-screen=\"runs\"]')?.focus(); true");
        await press("document", "P", true, true);
        await press("document.getElementById('palette-input')", "Escape");
        const escaped = await js("document.getElementById('palette')?.hasAttribute('hidden') === true && document.activeElement?.getAttribute('data-screen') === 'runs'");
        await press("document", "n", true);
        const newTask = await js("document.getElementById('work')?.getAttribute('data-screen')");
        await press("document", ",", true);
        const settings = await js("document.getElementById('work')?.getAttribute('data-screen')");
        await js("document.querySelector('.tree')?.removeAttribute('data-tree-ready'); true");
        await press("document.body", "F5");
        const refreshed = await waitFor("document.querySelector('.tree')?.getAttribute('data-tree-ready') ?? null", 20_000);
        await waitFor("[...document.querySelectorAll('.tree [data-key]')].some((li) => li.textContent.includes('b.txt')) ? 'ok' : null", 20_000);
        await js("document.querySelector('.tree [tabindex=\"0\"]')?.focus(); true");
        const from = await js("document.activeElement?.querySelector('.name')?.textContent ?? null");
        await press("document.querySelector('.tree')", "s");
        const jumped = await js("document.activeElement?.querySelector('.name')?.textContent ?? null");
        return { opened, listed, cancel, filtered, ran, escaped, newTask, settings, refreshed, jump: [from === "sub" ? "same" : "moved", jumped] };
      })();
      // U-68 (3.2): the checks on opening. A lock a live process holds (this test's own pid; judged by
      // the pid alone) shows on the workspace screen and turns the new task's run off; gone, it is on again.
      results["openCheck"] = await (async () => {
        const pressF5 = (): Promise<unknown> => js("document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true })); true");
        const card = "(() => { const c = document.getElementById('open-check'); const p = c?.getAttribute('data-open-check'); return p === 'done' || p === 'error' ? p + ':' + c.getAttribute('data-locked') : null; })()";
        await js("document.querySelector('[data-screen=\"home\"]')?.click(); true");
        const first = await waitFor(card, 60_000);
        const lockFile = join(SECOND, ".codaryn", "lock.json");
        writeFileSync(lockFile, JSON.stringify({ pid: process.pid, runId: "20261113T000000Z-0000a068", startedAt: new Date().toISOString() }));
        try {
          await pressF5();
          const held = await waitFor("document.getElementById('open-check')?.getAttribute('data-locked') === 'true' ? 'held' : null", 60_000);
          const line = await js("document.querySelector('#open-check [data-lock=\"held\"]')?.getAttribute('role') ?? null");
          await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
          await waitFor("document.getElementById('task-run') ? 'ready' : null", 30_000);
          const runOff = await js("[document.getElementById('task-run')?.hasAttribute('disabled'), document.getElementById('task-locked')?.hasAttribute('hidden')]");
          unlinkSync(lockFile);
          // U-123 (R-87 U-68 L1): showing the screen again looks again; no F5.
          await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
          const freed = await waitFor("document.getElementById('task-locked')?.hasAttribute('hidden') === true ? 'free' : null", 60_000);
          const runOn = await js("document.getElementById('task-run')?.hasAttribute('disabled') === false");
          return { first, held, line, runOff, freed, runOn };
        } finally {
          if (existsSync(lockFile)) unlinkSync(lockFile);
        }
      })();
      // U-69 (11, 3.10): the config file shown in its folder (recorded), and a language written in the
      // settings redraws the window in it at once; "auto" brings the OS language back.
      const treeIdOf = async (name: string): Promise<string> =>
        ((await js(`window.codaryn.tree(${JSON.stringify(second.ok ? second.handle : "")}, null, 0)`)) as { entries?: { id: string | null; name: string }[] }).entries?.find((entry) => entry.name === name)?.id ?? "";
      const idBeforeWrites = await treeIdOf("a.txt");
      results["languageNow"] = await (async () => {
        await js("document.querySelector('[data-screen=\"settings\"]')?.click(); true");
        await waitFor("document.getElementById('settings-reveal-config') ? 'ready' : null", 30_000);
        const before = revealed.length;
        await js("document.getElementById('settings-reveal-config')?.click(); true");
        const shown = await waitFor("document.getElementById('settings-reveal-status')?.getAttribute('data-revealed') ?? null");
        const file = revealed.slice(before).map((p) => p.split(/[\\/]/).pop());
        const from = String(await js("document.documentElement.lang"));
        const to = from === "ko" ? "en" : "ko";
        const homeBefore = await js("document.querySelector('#screens [data-screen=\"home\"]')?.textContent ?? null");
        const choose = async (value: string, lang: string): Promise<unknown> => {
          await waitFor("document.getElementById('settings-language-choice') ? 'ready' : null", 30_000);
          await js(`(() => { const c = document.getElementById('settings-language-choice'); c.value = ${JSON.stringify(value)}; document.getElementById('settings-language-change').click(); return true; })()`);
          await waitFor("document.getElementById('settings-write') ? 'ready' : null", 30_000);
          await js("document.getElementById('settings-write')?.click(); true");
          return waitFor(`document.documentElement.lang === ${JSON.stringify(lang)} ? 'redrawn' : null`, 30_000);
        };
        const switched = await choose(to, to);
        const homeAfter = await js("document.querySelector('#screens [data-screen=\"home\"]')?.textContent ?? null");
        const screen = await js("document.getElementById('work')?.getAttribute('data-screen')");
        const back = await choose("auto", from);
        return { shown, file, switched, renamed: homeAfter !== homeBefore, screen, back, lang: await js("document.documentElement.lang === " + JSON.stringify(from)) };
      })();
      // U-123 (R-82 U-103 L1): the settings writes above dropped the tree's ids; the window read its tree again.
      results["treeIdsDropped"] = await (async () => {
        const copy = (id: string): Promise<unknown> => js(`window.codaryn.copyPath(${JSON.stringify(second.ok ? second.handle : "")}, ${JSON.stringify(id)}).then((r) => (r.ok ? 'copied' : r.code))`);
        const old = await copy(idBeforeWrites);
        const fresh = await copy(await treeIdOf("a.txt"));
        const reread = await waitFor("document.querySelector('.tree')?.getAttribute('data-tree-ready') ?? null", 20_000);
        return { taken: idBeforeWrites.length === 32, old, fresh, reread };
      })();
      // U-70 (4.5, 3.1): the separator by the keys and by the pointer, and the width and screen in gui-state.json.
      results["windowState"] = await (async () => {
        const width = (): Promise<unknown> => js("Number(document.getElementById('splitter')?.getAttribute('aria-valuenow') ?? 'NaN')");
        const key = (name: string): Promise<unknown> => js(`document.getElementById('splitter')?.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true, cancelable: true })); true`);
        await key("Home");
        const min = await width();
        await key("ArrowRight");
        const step = Number(await width()) - Number(min);
        const panel = await js(
          "(() => { const s = document.getElementById('splitter'); const r = s.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + 20; const fire = (type, cx) => s.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: y, pointerId: 7, bubbles: true })); fire('pointerdown', x); fire('pointermove', x + 100); fire('pointerup', x + 100); return Math.round(document.getElementById('files').getBoundingClientRect().width); })()",
        );
        const dragged = Number(await width());
        await js("document.querySelector('[data-screen=\"checks\"]')?.click(); true");
        let saved: unknown = null;
        for (let waited = 0; waited < 10_000 && saved === null; waited += 200) {
          try {
            const memory = (JSON.parse(readFileSync(STATE, "utf8")) as { window?: { screen?: string; treeWidth?: number } }).window;
            if (memory?.screen === "checks" && memory.treeWidth === dragged) saved = { screen: memory.screen, treeWidth: memory.treeWidth };
          } catch {
            // Written through a temporary file; read again.
          }
          if (saved === null) await sleep(200);
        }
        return { min, step, dragged: dragged - Number(min) - step, panel: panel === dragged, saved };
      })();

      // 4. The recent list on the workspace screen and in gui-state.json: second first.
      await js("document.querySelector('[data-screen=\"home\"]')?.click(); true");
      results["recentShown"] = await waitFor("document.querySelector('.recent')?.getAttribute('data-recent-ready') ?? null");
      results["recentNames"] = await js("[...document.querySelectorAll('.recent .recent-name')].map((n) => n.textContent)");
      // R21-I-1: names and the folder they are in, never a full path.
      results["recentText"] = await js("document.querySelector('.recent')?.textContent ?? ''");
      try {
        const saved = JSON.parse(readFileSync(STATE, "utf8")) as { recentWorkspaces?: { path: string }[] };
        results["stateFile"] = (saved.recentWorkspaces ?? []).map((item) => item.path.split(/[\\/]/).pop());
      } catch {
        results["stateFile"] = "unreadable";
      }

      // 5. The checks screen for the open workspace.
      await js("document.querySelector('[data-screen=\"checks\"]')?.click(); true");
      results["checks"] = await waitFor("document.getElementById('checks')?.getAttribute('data-doctor-ready') ?? null");
      results["checksShown"] = await js("document.querySelectorAll('.checks li').length");
      results["lang"] = await js("document.documentElement.lang");
      results["url"] = contents.getURL();

      // 5b. GU-6: the settings screen; the model list only when asked for; choosing a model.
      await js("document.querySelector('[data-screen=\"settings\"]')?.click(); true");
      results["settingsReady"] = await waitFor("document.getElementById('settings')?.getAttribute('data-settings-ready') ?? null");
      results["settingsFile"] = await js(
        "(() => { const p = document.getElementById('settings-file'); return { source: p?.getAttribute('data-source') ?? null, text: p?.textContent ?? null }; })()",
      );
      results["settingsProfiles"] = await js("[...document.querySelectorAll('#settings-profiles [data-profile]')].map((li) => li.getAttribute('data-profile'))");
      results["settingsKey"] = await js("document.querySelector('#settings-key [data-key]')?.getAttribute('data-key') ?? null");
      results["settingsText"] = await js("document.getElementById('settings')?.textContent ?? ''");
      results["modelsBeforeAsking"] = await js("document.querySelectorAll('.models[data-models-ready]').length");
      await js("document.querySelector('[data-list-models]')?.click(); true");
      results["modelsListed"] = await waitFor("document.querySelector('.models')?.getAttribute('data-models-ready') ?? null");
      await js("[...document.querySelectorAll('.models li[data-model]')].find((li) => li.getAttribute('data-model') === 'fake-model-b')?.querySelector('button')?.click(); true");
      results["modelChosen"] = await waitFor("document.getElementById('settings-model-outcome')?.getAttribute('data-selected') ?? null");
      results["modelForgedEntry"] = await js(`window.codaryn.selectModel(${JSON.stringify("0".repeat(32))})`);
      results["modelIdAsEntry"] = await js("window.codaryn.selectModel('fake-model-a')");

      // 5b2. GU-6 (3.10, 6.6): settings changes, one edit at a time; "Write" sends the main process's token only.
      // Before the runs (DR-41): the config's policy is merged with each task kind's own, so the
      // organize plan runs below still move and discard after this step gives the config a policy.
      const proposal = (): Promise<unknown> =>
        waitFor("(() => { const p = document.getElementById('settings-proposal')?.getAttribute('data-proposal'); return p && p !== 'asking' ? p : null; })()");
      const written = (list: string): Promise<unknown> =>
        waitFor(
          `(() => { const ready = document.getElementById('settings')?.getAttribute('data-settings-ready'); const p = document.getElementById('settings-proposal')?.getAttribute('data-proposal'); return ready === 'ok' && p === 'written' ? [...document.querySelectorAll('#${list} li > span:first-child')].map((s) => s.textContent) : null; })()`,
        );
      await js("document.querySelector('[data-screen=\"settings\"]')?.click(); true");
      await waitFor("document.getElementById('settings')?.getAttribute('data-settings-ready') ?? null");
      results["settingsPolicyMerge"] = await js("document.getElementById('settings-policy-merge') !== null");
      const asked = dialogs.length;
      // Narrowing: a protected path. No dialog.
      await js("(() => { document.getElementById('settings-protected-path').value = 'notes/private.md'; document.getElementById('settings-protected-add').click(); return true; })()");
      results["settingsNarrow"] = await proposal();
      await js("document.getElementById('settings-write')?.click(); true");
      results["settingsNarrowWritten"] = await written("settings-protected");
      results["settingsNarrowDialogs"] = dialogs.length - asked;
      // Widening: a command. The first answer is "do not write" (nothing is written), the second "write".
      const addCommand = "(() => { document.getElementById('settings-command-exe').value = 'node'; document.getElementById('settings-command-args').value = '--version'; document.getElementById('settings-command-add').click(); return true; })()";
      await js(addCommand);
      results["settingsWiden"] = await proposal();
      results["settingsWidenKinds"] = await js("[...document.querySelectorAll('#settings-proposal .widening [data-kind]')].map((li) => li.getAttribute('data-kind'))");
      // DR-41: organize allows no command, so its runs leave the new rule out; the proposal says so.
      results["settingsWidenNarrowings"] = await js("[...document.querySelectorAll('#settings-proposal-narrowings li')].map((li) => [li.getAttribute('data-workflow'), li.getAttribute('data-kind')])");
      refuseWidening = true;
      await js("document.getElementById('settings-write')?.click(); true");
      results["settingsWidenRefused"] = await waitFor("(() => { const p = document.getElementById('settings-proposal')?.getAttribute('data-proposal'); return p === 'not_confirmed' ? p : null; })()");
      results["settingsAfterRefusal"] = (() => {
        try {
          const config = JSON.parse(readFileSync(process.env["CODARYN_CONFIG"] ?? "", "utf8")) as { policy?: { commands?: unknown[] } };
          return config.policy?.commands?.length ?? 0;
        } catch {
          return "unreadable";
        }
      })();
      await js(addCommand);
      await proposal();
      await js("document.getElementById('settings-write')?.click(); true");
      results["settingsWidenWritten"] = await written("settings-commands");
      results["settingsWidenDialogs"] = dialogs.filter((id) => id === "widen.message").length;
      // The page cannot send a config, reuse a token or make one up.
      results["settingsWholeConfig"] = await js("window.codaryn.proposeSettings({ op: 'replace', next: { schemaVersion: 1 } })");
      results["settingsForgedToken"] = await js(`window.codaryn.applySettings(${JSON.stringify("0".repeat(32))})`);
      results["settingsTokenOnce"] = await js(
        "(async () => { const p = await window.codaryn.proposeSettings({ op: 'addSecretEnv', name: 'SMOKE_SECRET_NAME' }); if (!p.ok) return p; const a = await window.codaryn.applySettings(p.token); const b = await window.codaryn.applySettings(p.token); return [a.ok && a.written, b.code]; })()",
      );
      // Removing a secret name widens: asked first (6.6).
      await js("document.querySelector('[data-screen=\"settings\"]')?.click(); true");
      await waitFor("document.getElementById('settings')?.getAttribute('data-settings-ready') ?? null");
      const widenAsked = dialogs.filter((id) => id === "widen.message").length;
      await js("[...document.querySelectorAll('#settings-secret-names li')].find((li) => li.textContent.includes('SMOKE_SECRET_NAME'))?.querySelector('[data-remove]')?.click(); true");
      results["settingsSecretRemoval"] = await proposal();
      await js("document.getElementById('settings-write')?.click(); true");
      results["settingsSecretRemoved"] = await waitFor(
        "(() => { const ready = document.getElementById('settings')?.getAttribute('data-settings-ready'); return ready === 'ok' && document.getElementById('settings-proposal')?.getAttribute('data-proposal') === 'written' ? document.getElementById('settings-secrets')?.textContent.includes('SMOKE_SECRET_NAME') === false : null; })()",
      );
      results["settingsSecretDialogs"] = dialogs.filter((id) => id === "widen.message").length - widenAsked;
      results["settingsOnDisk"] = (() => {
        try {
          const config = JSON.parse(readFileSync(process.env["CODARYN_CONFIG"] ?? "", "utf8")) as { model?: string; policy?: { commands?: unknown[]; protectedPaths?: unknown[] }; secretEnv?: unknown[] };
          return { model: config.model, commands: config.policy?.commands, protectedPaths: config.policy?.protectedPaths, secretEnv: config.secretEnv ?? [] };
        } catch {
          return "unreadable";
        }
      })();
      results["settingsChangeText"] = await js("document.getElementById('settings')?.textContent ?? ''");

      // 5b3. PM task (2): the provider choice. The providers come from the contract's table; a key shows
      // set or not by its variable's name. Switched to openai and back (later runs use anthropic).
      await js("document.querySelector('[data-screen=\"settings\"]')?.click(); true");
      await waitFor("document.getElementById('settings')?.getAttribute('data-settings-ready') ?? null");
      results["providerRows"] = await js("[...document.querySelectorAll('#settings-provider li[data-provider]')].map((li) => [li.getAttribute('data-provider'), li.getAttribute('data-key')])");
      results["providerInUse"] = await js("document.getElementById('settings-provider-current')?.getAttribute('data-provider') ?? null");
      const inUse =
        "(() => { const ready = document.getElementById('settings')?.getAttribute('data-settings-ready'); const p = document.getElementById('settings-proposal')?.getAttribute('data-proposal'); return ready === 'ok' && p === 'written' ? { inUse: document.getElementById('settings-provider-current')?.getAttribute('data-provider') ?? null, lists: document.querySelectorAll('[data-list-models]').length, noList: document.getElementById('settings-model-no-list') !== null } : null; })()";
      const choose = (name: string): string =>
        `(() => { const c = document.getElementById('settings-provider-choice'); c.value = ${JSON.stringify(name)}; document.getElementById('settings-provider-change').click(); return true; })()`;
      await js(choose("openai"));
      results["providerProposal"] = await proposal();
      results["providerWidenKinds"] = await js("[...document.querySelectorAll('#settings-proposal .widening [data-kind]')].map((li) => li.getAttribute('data-kind'))");
      await js("document.getElementById('settings-write')?.click(); true");
      results["providerOpenai"] = await waitFor(inUse);
      results["providerText"] = await js("document.getElementById('settings')?.textContent ?? ''");
      await js(choose("anthropic"));
      await proposal();
      await js("document.getElementById('settings-write')?.click(); true");
      results["providerBack"] = await waitFor(inUse);
      results["providerOnDisk"] = (() => {
        try {
          return (JSON.parse(readFileSync(process.env["CODARYN_CONFIG"] ?? "", "utf8")) as { provider?: string }).provider ?? null;
        } catch {
          return "unreadable";
        }
      })();

      // R-111b M-1: a start on the new task screen (shown and ready) records whether the run button was
      // on at once (startsBlocked: the product's own check, no wait), then waits for it to be on, sets the
      // form (`setup`) and presses it. The wait keeps a slow open check on a busy machine from failing the
      // steps after it; it does not hide a lock carried from this window's own run, which startsBlocked shows.
      const pressRun = async (where: string, setup: string): Promise<void> => {
        const off = await js(
          "document.getElementById('task-run')?.hasAttribute('disabled') ? { where: " +
            JSON.stringify(where) +
            ", locked: document.getElementById('task-locked')?.hasAttribute('hidden') === false, lock: document.getElementById('task-locked')?.getAttribute('data-lock') ?? null, message: document.getElementById('task-message')?.textContent ?? null } : null",
        );
        if (off !== null) startsBlocked.push(off);
        await waitFor("document.getElementById('task-run')?.hasAttribute('disabled') === false ? 'on' : null", 60_000);
        await js(`(() => { ${setup} document.getElementById('task-run').click(); return true; })()`);
      };
      // 5c. GU-3: a run from the new task screen (the fake API asks to read a.txt, then ends).
      const startTask = async (goal: string): Promise<void> => {
        await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
        await waitFor("document.getElementById('newtask')?.getAttribute('data-newtask-ready') ?? null");
        await pressRun(goal, `const g = document.getElementById('task-goal'); g.value = ${JSON.stringify(goal)};`);
      };
      // U-5 (3.6): the window is not active while this run ends, so its end is one OS notification.
      pretendInactive = true;
      await startTask("a.txt를 읽고 요약한다");
      results["runDone"] = await waitFor("document.querySelector('#work')?.getAttribute('data-run-phase') === 'done' ? 'done' : null", 90_000);
      results["runResult"] = await js(
        "(() => { const r = document.getElementById('run-result'); return r === null ? null : { status: r.getAttribute('data-status'), reason: r.getAttribute('data-reason'), runId: document.getElementById('run-result-id')?.textContent ?? null }; })()",
      );
      results["runLog"] = await js("[...document.querySelectorAll('#run-log li')].map((li) => li.getAttribute('data-kind'))");
      // U-54 (R-65 L-1): this run's denial, of the call the engine recorded as codaryn-call-1.
      results["firstRunDenied"] = {
        denied: await js("document.querySelectorAll('#run-log li[data-kind=\"tool_denied\"]').length"),
        call: replacedCall((results["runResult"] as { runId?: string } | null)?.runId ?? ""),
      };
      results["runCounts"] = await js("document.getElementById('run-counts')?.textContent ?? null");
      // U-21 (DR-47): the run ended with the reply "done": the agent's last message under its label.
      results["runFinalMessage"] = await js(
        "(() => { const box = document.getElementById('run-final-message'); return box === null ? null : { label: box.querySelector('h4')?.textContent ?? null, text: document.getElementById('run-final-message-text')?.textContent ?? null, cut: box.querySelector('p.notice') !== null }; })()",
      );
      // U-40 (DR-52): the masking counts right after the usage, the counts the run's result recorded.
      results["runMasking"] = {
        line: await js("(() => { const line = document.getElementById('run-masking'); return line === null ? null : { text: line.textContent, after: line.previousElementSibling?.id === 'run-usage' }; })()"),
        recorded: recordedMasking((results["runResult"] as { runId?: string } | null)?.runId ?? ""),
      };
      results["runText"] = await js("document.getElementById('work')?.textContent ?? ''");
      results["runAgainWhileIdle"] = await js("window.codaryn.cancelRun()");
      results["endNotice"] = notices[0] ?? null;
      pretendInactive = false;
      // U-62 (6.4, R-73): the run id through the main process; anything but a run id or a digest's first 12 is refused, nothing written.
      await js("document.getElementById('run-copy-id')?.click(); true");
      results["copyRunId"] = {
        status: await waitFor("document.querySelector('#run-copy-id + .copy-status')?.getAttribute('data-copied') ?? null"),
        copied: copied.at(-1) ?? null,
        runId: (results["runResult"] as { runId?: string } | null)?.runId ?? null,
      };
      results["copyRefused"] = await (async () => {
        const before = copied.length;
        const code = (call: string): Promise<unknown> => js(`${call}.then((reply) => reply.ok === true ? "copied" : reply.code)`);
        return {
          keyShape: await code(`window.codaryn.copyText(${JSON.stringify(COPY_KEY_SHAPED)})`),
          keyValue: await code(`window.codaryn.copyText(${JSON.stringify(process.env["ANTHROPIC_API_KEY"] ?? "")})`),
          path: await code("window.codaryn.copyText('sub/b.txt')"),
          words: await code("window.codaryn.copyText('any text at all')"),
          digestUpper: await code("window.codaryn.copyText('0123456789AB')"),
          lineBreak: await code("window.codaryn.copyText('a\\nb')"),
          written: copied.length - before,
        };
      })();
      // U-61 (3.12): the first run changed a file, so its result offers the revert preview, opened on the run list.
      results["revertFromResult"] = {
        runId: (results["runResult"] as { runId?: string } | null)?.runId ?? null,
        offered: await js("document.getElementById('run-revert-preview') !== null"),
        preview: await (async () => {
          await js("document.getElementById('run-revert-preview')?.click(); true");
          return waitFor("(() => { const p = document.getElementById('revert-panel')?.getAttribute('data-preview'); return p && p !== 'loading' ? p : null; })()", 30_000);
        })(),
        title: await js("document.getElementById('revert-title')?.textContent ?? null"),
      };
      // U-65 (3.3): the run ended, so the tree was read again and marks the file the run made; choosing it opens the comparison there.
      results["treeMarks"] = {
        made: await waitFor("document.querySelector('.tree [data-change=\"created\"] .name')?.textContent ?? null", 20_000),
        note: await js(`document.getElementById('tree-marks-text')?.textContent?.includes(${JSON.stringify((results["runResult"] as { runId?: string } | null)?.runId ?? "?")}) === true`),
      };
      await js("document.querySelector('.tree [data-change=\"created\"]')?.click(); true");
      results["treeOpensChange"] = {
        ready: await waitFor("(() => { const r = document.getElementById('changes')?.getAttribute('data-changes-ready'); return r && r !== 'none' ? r : null; })()"),
        focus: await js("document.getElementById('changes')?.getAttribute('data-focus-file') ?? null"),
        focused: await js("document.activeElement?.querySelector('.path')?.textContent ?? null"),
      };
      // U-66 (3.4): side by side, wrapping off, and "show in folder" from the comparison by the main process's id.
      results["changesViews"] = await (async () => {
        const flip = (id: string, on: boolean): Promise<unknown> => js(`(() => { const b = document.getElementById(${JSON.stringify(id)}); if (!b) return false; b.checked = ${on}; b.dispatchEvent(new Event('change')); return true; })()`);
        await flip("changes-side", true);
        const side = await js(
          "({ view: document.getElementById('changes')?.getAttribute('data-view'), tables: document.querySelectorAll('#changes table.diff-side').length, columns: document.querySelectorAll('#changes ol.diff').length, hunks: document.querySelectorAll('#changes table.diff-side tr[data-hunk]').length, first: [document.querySelector('#changes table.diff-side tbody tr')?.getAttribute('data-left') ?? null, document.querySelector('#changes table.diff-side tbody tr')?.getAttribute('data-right') ?? null] })",
        );
        await flip("changes-wrap", false);
        const wrap = await js("document.getElementById('changes')?.getAttribute('data-wrap') ?? null");
        const before = revealed.length;
        await js("document.querySelector('#changes [data-reveal]')?.click(); true");
        const status = await waitFor("document.querySelector('#changes .reveal-status')?.getAttribute('data-revealed') ?? null");
        const shown = revealed.slice(before).map((path) => path.split(/[\\/]/).pop());
        await flip("changes-side", false);
        await flip("changes-wrap", true);
        return { side, wrap, status, shown, back: await js("[document.getElementById('changes')?.getAttribute('data-view'), document.getElementById('changes')?.getAttribute('data-wrap')]") };
      })();

      // 5d. GU-3: a run that hangs, cancelled from the window (asked first; "keep running" is the default).
      // R29-L1: cancelled only once its model request reached the fake API, so the script's hanging
      // answer is the one this run used, whatever the machine's speed.
      const beforeHang = messagesReceived();
      await startTask("멈추는 작업");
      results["cancelReady"] = await waitFor("document.getElementById('run-cancel')?.hasAttribute('disabled') === false ? 'ready' : null", 60_000);
      results["cancelRequestArrived"] = await requestArrived(beforeHang);
      results["secondStartRefused"] = await js(`window.codaryn.startRun(${JSON.stringify(second.ok ? second.handle : "")}, 'again', null, null)`);
      await js("document.getElementById('run-cancel').click(); true");
      results["cancelAsked"] = await js("document.getElementById('run-confirm')?.hasAttribute('hidden') === false && document.activeElement?.id === 'run-keep'");
      await js("document.getElementById('run-cancel-sure').click(); true");
      results["cancelDone"] = await waitFor("document.querySelector('#work')?.getAttribute('data-run-phase') === 'done' ? document.getElementById('run-result')?.getAttribute('data-status') ?? 'no result' : null", 60_000);

      // 5e. GU-4: the run list, a revert preview, refused requests, and the revert (the main process asks).
      const secondHandle = second.ok ? second.handle : "";
      const firstRun = (results["runResult"] as { runId?: string } | null)?.runId ?? "";
      await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
      results["runsListed"] = await waitFor("(() => { const r = document.getElementById('runs-list')?.getAttribute('data-runs-ready'); return r && r !== 'loading' ? r : null; })()");
      results["runsRows"] = await js("[...document.querySelectorAll('#runs-list li[data-run]')].map((li) => ({ state: li.getAttribute('data-state'), status: li.getAttribute('data-status') }))");
      await js(`document.querySelector('[data-preview="${firstRun}"]')?.click(); true`);
      results["revertPreview"] = await waitFor("(() => { const p = document.getElementById('revert-panel')?.getAttribute('data-preview'); return p && p !== 'loading' ? p : null; })()");
      results["revertPreviewActions"] = await js("[...document.querySelectorAll('#revert-panel [data-action]')].map((li) => li.getAttribute('data-action'))");
      results["madeBeforeRevert"] = existsSync(join(SECOND, "made.txt"));
      results["revertForged"] = await js(`window.codaryn.revert(${JSON.stringify("0".repeat(32))})`);
      results["previewLatest"] = await js(`window.codaryn.previewRevert(${JSON.stringify(secondHandle)}, 'latest')`);
      results["previewUnlisted"] = await js(`window.codaryn.previewRevert(${JSON.stringify(secondHandle)}, '20200101T000000Z-00000000')`);
      await js("document.getElementById('revert-run')?.click(); true");
      results["revertDone"] = await waitFor("document.getElementById('revert-panel')?.getAttribute('data-revert') ?? null", 60_000);
      results["madeAfterRevert"] = existsSync(join(SECOND, "made.txt"));
      // DR-25: nothing was skipped as an unsafe move, so no consent is offered; a forged retry token is refused.
      results["revertNoConsentOffer"] = await js("document.getElementById('revert-consent') === null");
      results["revertConsentForged"] = await js(`window.codaryn.revertConsent(${JSON.stringify("0".repeat(32))})`);

      // 5e'. DR-29: the first run's changed file by path and state (it was reverted, so it is gone now).
      await waitFor(`document.querySelector('[data-changes="${firstRun}"]') !== null ? 'ready' : null`, 30_000);
      await js(`document.querySelector('[data-changes="${firstRun}"]')?.click(); true`);
      results["changesShown"] = await waitFor("(() => { const r = document.getElementById('changes')?.getAttribute('data-changes-ready'); return r && r !== 'none' ? r : null; })()");
      results["changesRows"] = await js(
        "[...document.querySelectorAll('#changes .changed-file')].map((s) => ({ state: s.getAttribute('data-state'), created: s.getAttribute('data-created'), text: s.getAttribute('data-text'), path: s.querySelector('.path')?.textContent ?? null }))",
      );
      results["changesText"] = await js("document.getElementById('changes')?.textContent ?? ''");
      results["changesLatest"] = await js(`window.codaryn.changes(${JSON.stringify(secondHandle)}, 'latest', null)`);

      // 5f. GU-5: a plan run (organize), the plan screen, refused requests, and an apply the main process asked about.
      const resultId = (): Promise<unknown> => js("document.getElementById('run-result-id')?.textContent ?? null");
      // U-178: a new result id, or "error:<code>" as soon as the run screen (when it is the one shown: its
      // own #run-state and #run-end) shows a start or an end that failed (no waiting out the time for a run
      // that is not going on), or "timeout". Anything but a run id is noted in stepFailures with what the
      // window, the start blocks and the lock file showed.
      results["stepFailures"] = stepFailures;
      const newResult = async (previous: unknown, ms = 90_000, step = "result"): Promise<unknown> => {
        const startedAt = Date.now();
        const value = await waitFor(
          `(() => { const id = document.getElementById('run-result-id')?.textContent ?? null; if (id !== null && id !== ${JSON.stringify(previous)}) return id; const phase = document.getElementById('run-state')?.getAttribute('data-phase') ?? null; const error = document.querySelector('#run-end [data-error]')?.getAttribute('data-error') ?? null; return error !== null && (phase === 'idle' || phase === 'done') ? 'error:' + error : null; })()`,
          stepFailures.length > 0 ? Math.min(ms, AFTER_FAILURE_MS) : ms,
        );
        if (isRunIdValue(value)) return value;
        stepFailures.push({
          step,
          previous,
          value,
          waitedMs: Date.now() - startedAt,
          screen: await js("document.getElementById('work')?.getAttribute('data-screen') ?? null"),
          runPhase: await js("document.getElementById('run-state')?.getAttribute('data-phase') ?? null"),
          error: await js("document.querySelector('#work [data-error]')?.getAttribute('data-error') ?? null"),
          startsBlocked: [...startsBlocked],
          lock: lockNow(),
          apiMessages: messagesReceived(),
        });
        return value;
      };
      const taskWith = async (workflow: string, goal: string): Promise<void> => {
        await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
        await waitFor("document.getElementById('newtask')?.getAttribute('data-newtask-ready') ?? null");
        // U-123: a start whose run button is off is recorded (it would not start; the reason helps).
        await pressRun(workflow, `document.getElementById('task-workflow').value = ${JSON.stringify(workflow)}; const g = document.getElementById('task-goal'); g.value = ${JSON.stringify(goal)};`);
      };
      // A: the task kind chosen directly (R-14 L-3, R21-M-1): the plan view, its apply and the
      // file moved, through the task form's workflowRef.
      const beforeDirect = await resultId();
      await taskWith("organize", "a.txt를 moved 폴더로 옮긴다");
      const directRunId = await newResult(beforeDirect, 90_000, "5f plan run A");
      await js("document.getElementById('run-view-plan')?.click(); true");
      // U-119: the apply waits for the check before an apply.
      const planCheckReady = (): Promise<unknown> => waitFor("(() => { const c = document.getElementById('plan-check')?.getAttribute('data-check'); return c && c !== 'checking' ? c : null; })()", 60_000);
      results["directPlanShown"] = await waitFor("(() => { const r = document.getElementById('plan')?.getAttribute('data-plan-ready'); return r && r !== 'none' ? r : null; })()");
      // U-62 (3.9): the digest's first 12 characters, as the plan shows them.
      await js("document.getElementById('plan-copy-digest')?.click(); true");
      results["copyDigest"] = {
        status: await waitFor("document.querySelector('#plan-copy-digest + .copy-status')?.getAttribute('data-copied') ?? null"),
        copied: copied.at(-1) ?? null,
        summary: await js("document.getElementById('plan-summary')?.textContent ?? ''"),
      };
      // U-32 (U-14 AXM-15): the model's summary under the agent's-words label, after the actions,
      // drawn by the engine's quoteModelText.
      results["planAgentWords"] = await js(
        "(() => { const ids = [...(document.getElementById('plan')?.children ?? [])].map((c) => c.id); return { label: document.querySelector('#plan-agent-words .notice')?.textContent ?? null, text: document.getElementById('plan-agent-words-text')?.textContent ?? null, afterActions: ids.indexOf('plan-actions') >= 0 && ids.indexOf('plan-actions') < ids.indexOf('plan-agent-words') }; })()",
      );
      await planCheckReady();
      await js("document.getElementById('plan-apply')?.click(); true");
      await newResult(directRunId, 90_000, "5f apply A");
      results["applyByWorkflow"] = await js(
        "(() => { const r = document.getElementById('run-result'); return r === null ? null : { status: r.getAttribute('data-status'), reason: r.getAttribute('data-reason'), applied: document.querySelectorAll('#run-applied li').length }; })()",
      );
      results["applyByWorkflowMoved"] = { from: existsSync(join(SECOND, "a.txt")), to: existsSync(join(SECOND, "moved", "a.txt")) };

      // B: through a profile whose workflowRef is organize: the plan's apply takes the same profile.
      const beforePlan = await resultId();
      await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
      await waitFor("document.getElementById('newtask')?.getAttribute('data-newtask-ready') ?? null");
      await pressRun("profile tidy", "document.getElementById('task-workflow').value = ''; document.getElementById('task-profile').value = 'tidy'; const g = document.getElementById('task-goal'); g.value = 'sub/b.txt를 moved 폴더로 옮긴다';");
      const planRunId = (await newResult(beforePlan, 90_000, "5f plan run B")) as string;
      results["planRun"] = await js("document.getElementById('run-result')?.getAttribute('data-reason') ?? null");
      // R21b-L-1: B's plan is opened from the run list, with the form the main process remembered
      // when B started (profile tidy), and applied from there.
      await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
      await waitFor("(() => { const r = document.getElementById('runs-list')?.getAttribute('data-runs-ready'); return r && r !== 'loading' ? r : null; })()");
      await js(`document.querySelector('[data-plan="${planRunId}"]')?.click(); true`);
      results["planShown"] = await waitFor("(() => { const r = document.getElementById('plan')?.getAttribute('data-plan-ready'); return r && r !== 'none' ? r : null; })()");
      results["planFromList"] = await js("({ apply: document.getElementById('plan-apply') !== null, unknown: document.getElementById('plan-form-unknown') !== null })");
      results["planActions"] = await js("[...document.querySelectorAll('#plan-actions li')].map((li) => li.getAttribute('data-kind'))");
      results["planForged"] = await js(`window.codaryn.applyPlan(${JSON.stringify("0".repeat(32))}, false)`);
      // A fresh approval of the same plan, asking for a consent its apply never needed: refused before any dialog.
      results["consentUnasked"] = await js(
        `window.codaryn.plan(${JSON.stringify(secondHandle)}, ${JSON.stringify(planRunId)}, 'tidy').then((r) => window.codaryn.applyPlan(r.approval, true))`,
      );
      // U-119 (3.9, DR-21): the check before the apply: clean on this drive, no consent needed, nothing left; a forged token is refused.
      results["planCheck"] = {
        state: await planCheckReady(),
        rows: await js("document.querySelectorAll('#plan-actions [data-problem], #plan-actions [data-unsafe]').length"),
        left: await js("document.querySelectorAll('#plan-check-probes-left, #plan-check-lock-left').length"),
        forged: await js(`window.codaryn.checkPlan(${JSON.stringify("0".repeat(32))}).then((r) => (r.ok ? 'checked' : r.code))`),
      };
      await js("document.getElementById('plan-apply')?.click(); true");
      await newResult(planRunId, 90_000, "5f apply B");
      results["applyDone"] = await js(
        "(() => { const r = document.getElementById('run-result'); return r === null ? null : { status: r.getAttribute('data-status'), reason: r.getAttribute('data-reason'), applied: document.querySelectorAll('#run-applied li').length }; })()",
      );
      results["applyMoved"] = { from: existsSync(join(SECOND, "sub", "b.txt")), to: existsSync(join(SECOND, "moved", "b.txt")) };
      // U-61 (U-16): the run list tells of both plans' applies, by the contract's rule.
      await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
      await waitFor("(() => { const r = document.getElementById('runs-list')?.getAttribute('data-runs-ready'); return r && r !== 'loading' ? r : null; })()");
      results["planApplyInList"] = await js(
        `[${JSON.stringify(directRunId)}, ${JSON.stringify(planRunId)}].map((id) => document.querySelector('[data-run="' + id + '"] [data-plan-apply]')?.getAttribute('data-plan-apply') ?? null)`,
      );
      // The forms are in gui-state.json, which the next start reads (newest first; applies are not remembered).
      results["stateForms"] = (() => {
        try {
          const saved = JSON.parse(readFileSync(STATE, "utf8")) as { workspaceMemory?: { path: string; runs: { runId: string; profile: string | null; workflow: string | null }[] }[] };
          const name = SECOND.split(/[\\/]/).pop();
          const entry = (saved.workspaceMemory ?? []).find((item) => item.path.split(/[\\/]/).pop() === name);
          if (entry === undefined) return null;
          return entry.runs.filter((run) => run.runId === planRunId || run.runId === directRunId).map((run) => [run.runId === planRunId ? "B" : "A", run.profile, run.workflow]);
        } catch {
          return "unreadable";
        }
      })();

      // 5g. GU-5: an analyze run that ends waiting for a person's review; the verdict is recorded.
      const beforeReview = await resultId();
      await taskWith("analyze", "a.txt를 분석한다");
      const analyzeRunId = (await newResult(beforeReview, 90_000, "5g analyze run")) as string;
      // U-54 (R-65 L-1): this run's codaryn-call-1 failed after the first run's codaryn-call-1 was
      // denied, in the same window (one engine host): its line is in this run's progress list.
      results["failedAfterDenial"] = {
        call: replacedCall(analyzeRunId),
        failed: await js("[...document.querySelectorAll('#run-log li[data-kind=\"tool_result\"] .text')].map((s) => s.textContent).filter((text) => text.includes('not_found'))"),
      };
      results["reviewRun"] = await js("document.getElementById('run-result')?.getAttribute('data-reason') ?? null");
      if ((await js("document.getElementById('review-accept') !== null")) === true) {
        await js("document.getElementById('review-accept').click(); true");
        results["reviewAsked"] = await js("document.getElementById('review-confirm')?.hasAttribute('hidden') === false && document.activeElement?.id === 'review-back'");
        await js("document.getElementById('review-record').click(); true");
        results["reviewRecorded"] = await waitFor("document.getElementById('review-outcome')?.getAttribute('data-verdict') ?? null", 30_000);
      }

      // 5h. DR-29, DR-32 (c): the analyze run wrote report.md and notes.md; the same secrets mask
      // them as the run did. report.md is still what the run left, so its text is shown and compared
      // (a created file: every line added). notes.md is changed here after the run: per file, it
      // shows its path and state only.
      writeFileSync(join(SECOND, "notes.md"), "changed after the run\n");
      await js("document.getElementById('run-view-changes')?.click(); true");
      results["reportChanges"] = await waitFor("(() => { const r = document.getElementById('changes')?.getAttribute('data-changes-ready'); return r && r !== 'none' ? r : null; })()");
      results["reportDiff"] = await js(
        "(() => { const s = document.querySelector('#changes .changed-file'); return s === null ? null : { text: s.getAttribute('data-text'), kinds: [...s.querySelectorAll('.diff li')].map((li) => li.getAttribute('data-kind')), lines: [...s.querySelectorAll('.diff .text')].map((t) => t.textContent) }; })()",
      );
      results["changesPerFile"] = await js(
        "[...document.querySelectorAll('#changes .changed-file')].map((s) => ({ path: s.querySelector('.path')?.textContent ?? null, state: s.getAttribute('data-state'), text: s.getAttribute('data-text'), hidden: s.querySelector('[data-text=\"hidden\"]') !== null }))",
      );
      results["changesPerFileText"] = await js("document.getElementById('changes')?.textContent ?? ''");
      // F7 moves the focus to the first change.
      results["reportF7"] = await js(
        "(() => { const body = document.getElementById('changes'); const first = body?.querySelector('.changed-file'); if (!body || !first) return 'no file section'; first.focus(); body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true })); return document.activeElement?.hasAttribute('data-hunk') === true; })()",
      );

      // 5i. GU-3 (3.7): the analyze run's report from its result: tabs, the summary, the verdict.
      await js("document.querySelector('[data-screen=\"run\"]')?.click(); true");
      await js("document.getElementById('run-view-report')?.click(); true");
      results["reportReady"] = await waitFor("(() => { const r = document.getElementById('report')?.getAttribute('data-report-ready'); return r && r !== 'none' ? r : null; })()");
      results["reportTabs"] = await js("[...document.querySelectorAll('#report [role=tab]')].map((b) => b.getAttribute('data-tab'))");
      results["reportSummary"] = await js("document.getElementById('report-status')?.getAttribute('data-reason') ?? null");
      // U-40 (DR-52): the usage tab has the analyze run's masking counts after the usage line.
      await js("document.querySelector('#report [role=tab][data-tab=\"usage\"]')?.click(); true");
      results["reportMasking"] = {
        line: await js("(() => { const line = document.getElementById('report-masking'); return line === null ? null : { text: line.textContent, after: line.previousElementSibling !== null && line.previousElementSibling === line.parentElement?.firstElementChild }; })()"),
        recorded: recordedMasking(analyzeRunId),
      };
      await js("document.querySelector('#report [role=tab][data-tab=\"review\"]')?.click(); true");
      results["reportVerdict"] = await js("document.getElementById('report-verdict')?.getAttribute('data-verdict') ?? null");
      results["reportText"] = await js("document.getElementById('report')?.textContent ?? ''");
      // U-5 (3.7): the analyze run's report saved as Markdown; the window learns the file's name only.
      await js("document.getElementById('report-save')?.click(); true");
      results["reportSaved"] = await waitFor("document.getElementById('report-save-status')?.getAttribute('data-saved') ?? null");
      results["reportSaveText"] = await js("document.getElementById('report-save-status')?.textContent ?? ''");
      results["reportFile"] = (() => {
        const name = savedReports[0];
        if (name === undefined) return null;
        try {
          return { name, runId: analyzeRunId, text: readFileSync(join(SAVED_REPORTS, name), "utf8") };
        } catch {
          return { name, runId: analyzeRunId, text: null };
        }
      })();
      // From the run list: the first run's report (it created made.txt, since reverted).
      await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
      await waitFor("(() => { const r = document.getElementById('runs-list')?.getAttribute('data-runs-ready'); return r && r !== 'loading' ? r : null; })()");
      await js(`document.querySelector('[data-report="${firstRun}"]')?.click(); true`);
      results["listReport"] = await waitFor(
        "(() => { const r = document.getElementById('report')?.getAttribute('data-report-ready'); return r && r !== 'none' ? (document.getElementById('report-status')?.getAttribute('data-reason') ?? r) : null; })()",
      );
      // U-79 (3.7, 3.8): the analyze run waits for a review; its row opens the report on the review tab (its verdict, recorded in 5g).
      await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
      await waitFor("(() => { const r = document.getElementById('runs-list')?.getAttribute('data-runs-ready'); return r && r !== 'loading' ? r : null; })()");
      results["reviewFromList"] = {
        offered: await js(`document.querySelector('[data-review="${analyzeRunId}"]') !== null`),
        tab: await (async () => {
          await js(`document.querySelector('[data-review="${analyzeRunId}"]')?.click(); true`);
          return waitFor("(() => { const r = document.getElementById('report')?.getAttribute('data-report-ready'); return r && r !== 'none' ? (document.getElementById('report-panel')?.getAttribute('data-tab') ?? r) : null; })()");
        })(),
        verdict: await js("document.getElementById('report-verdict')?.getAttribute('data-verdict') ?? null"),
        others: await js(`document.querySelectorAll('[data-review]').length`),
      };
      // U-92 (R-73, U-79 L1): a verdict only for a run the person was shown, with the form the main process remembers.
      results["reviewGuard"] = {
        forgedForm: await js(`window.codaryn.review(${JSON.stringify(second.ok ? second.handle : "")}, ${JSON.stringify(analyzeRunId)}, 'nonesuch', 'nonesuch', 'accept', null).then((r) => (r.ok ? r.verdict : r.code))`),
        unlisted: await js(`window.codaryn.review(${JSON.stringify(second.ok ? second.handle : "")}, '20261113T000000Z-00000000', null, null, 'accept', null).then((r) => (r.ok ? 'recorded' : r.code))`),
      };

      // 5i2. UXM-14, DR-38: a records-changed mark on the analyze run, as a command outside the run could
      // leave it. The run list marks the run and its report warns.
      if (isRunIdValue(analyzeRunId)) writeFileSync(join(SECOND, ".codaryn", "runs", analyzeRunId, "records-changed.json"), "{}");
      await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
      await waitFor("(() => { const r = document.getElementById('runs-list')?.getAttribute('data-runs-ready'); return r && r !== 'loading' ? r : null; })()");
      results["runsRecordsChanged"] = await js(`document.querySelector('[data-run="${analyzeRunId}"] [data-records-changed]') !== null`);
      results["runsUnmarked"] = await js("document.querySelectorAll('[data-records-changed]').length");
      await js(`document.querySelector('[data-report="${analyzeRunId}"]')?.click(); true`);
      results["reportRecordsChanged"] = await waitFor("document.getElementById('report-records-changed') !== null ? true : null", 20_000);
      // U-32: above the report's tabs; and the revert preview of the marked run says so, as the CLI's revert does.
      results["reportRecordsChangedFirst"] = await js("document.getElementById('report')?.firstElementChild?.id ?? null");
      await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
      await waitFor("(() => { const r = document.getElementById('runs-list')?.getAttribute('data-runs-ready'); return r && r !== 'loading' ? r : null; })()");
      await js(`document.querySelector('[data-preview="${analyzeRunId}"]')?.click(); true`);
      await waitFor("(() => { const r = document.getElementById('revert-panel')?.getAttribute('data-preview'); return r && r !== 'loading' ? r : null; })()");
      results["revertRecordsChanged"] = await js("document.getElementById('revert-records-changed') !== null");
      // U-48 (U-43): the marked run's changes have the warning first; its files come without text (5h showed it before the mark).
      await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
      await waitFor("(() => { const r = document.getElementById('runs-list')?.getAttribute('data-runs-ready'); return r && r !== 'loading' ? r : null; })()");
      await js(`document.querySelector('[data-changes="${analyzeRunId}"]')?.click(); true`);
      results["changesRecordsChanged"] = {
        ready: await waitFor("(() => { const r = document.getElementById('changes')?.getAttribute('data-changes-ready'); return r && r !== 'none' ? r : null; })()"),
        ...((await js(
          "(() => { const body = document.getElementById('changes'); return { first: body?.firstElementChild?.id ?? null, files: body?.querySelectorAll('.changed-file').length ?? 0, hidden: body?.querySelectorAll('[data-text=\"hidden\"]').length ?? 0, diffs: body?.querySelectorAll('.diff').length ?? 0 }; })()",
        )) as Record<string, unknown>),
      };

      // 5j1. DR-44 (a): the analyze run changed files and was never reverted. Its records are asked about
      // apart (the plan, then "also remove the records of runs not reverted?", answered "keep them"),
      // and they stay (not_reverted_not_confirmed); nothing is removed.
      await js("document.querySelector('[data-screen=\"cleanup\"]')?.click(); true");
      await waitFor("(() => { const r = document.getElementById('cleanup')?.getAttribute('data-cleanup-ready'); return r && r !== 'none' ? r : null; })()");
      await js(`(() => { const box = document.querySelector('[data-run-select="${analyzeRunId}"]'); if (box === null) return false; box.checked = true; document.getElementById('cleanup-preview').click(); return true; })()`);
      results["cleanupKeepPlan"] = await waitFor("document.getElementById('cleanup-plan')?.getAttribute('data-plan') ?? null");
      results["cleanupKeepNotice"] = await js("document.getElementById('cleanup-plan-not-reverted') !== null");
      const askedBeforeKeep = dialogs.length;
      keepNotReverted = true;
      await js("document.getElementById('cleanup-apply')?.click(); true");
      results["cleanupKeepResult"] = await waitFor("document.getElementById('cleanup-result')?.getAttribute('data-result') ?? null");
      // U-22 (DR-48): nothing was removed; the window says so as a result, not an error.
      results["cleanupKeepStatus"] = { status: await js("document.getElementById('cleanup-result')?.getAttribute('data-status') ?? null"), notice: await js("document.getElementById('cleanup-status')?.getAttribute('data-status') ?? null") };
      results["cleanupKeepRemoved"] = await js("document.getElementById('cleanup-removed')?.getAttribute('data-removed') ?? null");
      results["cleanupKeepReasons"] = await js("[...document.querySelectorAll('#cleanup-kept [data-reason]')].map((li) => li.getAttribute('data-reason'))");
      results["cleanupKeepDialogs"] = dialogs.slice(askedBeforeKeep);
      results["cleanupKeepStays"] = existsSync(join(SECOND, ".codaryn", "runs", analyzeRunId));

      // 5j. GU-4 (3.8), DR-39, DR-44: the state summary; a cleanup plan of the fully reverted runs (the
      // first run, reverted in 5e); the cleanup the main process asked about (the plan only: no run
      // left unreverted, no discard box in it); the record gone; a made-up token refused.
      await js("document.querySelector('[data-screen=\"cleanup\"]')?.click(); true");
      results["cleanupReady"] = await waitFor("(() => { const r = document.getElementById('cleanup')?.getAttribute('data-cleanup-ready'); return r && r !== 'none' ? r : null; })()");
      const runsBefore = Number(await js("document.querySelector('#cleanup-summary [data-runs]')?.getAttribute('data-runs') ?? '-1'"));
      results["cleanupRunsBefore"] = runsBefore;
      await js("(() => { document.getElementById('cleanup-runs-reverted').checked = true; document.getElementById('cleanup-preview').click(); return true; })()");
      results["cleanupPlan"] = await waitFor("document.getElementById('cleanup-plan')?.getAttribute('data-plan') ?? null");
      results["cleanupPlanItems"] = await js(`[...document.querySelectorAll('#cleanup-items li')].map((li) => [li.getAttribute('data-target'), li.getAttribute('data-id') === ${JSON.stringify(String(firstRun))} ? 'first run' : li.getAttribute('data-id')])`);
      const askedBeforeCleanup = dialogs.length;
      await js("document.getElementById('cleanup-apply')?.click(); true");
      results["cleanupResult"] = await waitFor("document.getElementById('cleanup-result')?.getAttribute('data-result') ?? null");
      results["cleanupStatus"] = await js("document.getElementById('cleanup-result')?.getAttribute('data-status') ?? null");
      results["cleanupRemoved"] = await js("document.getElementById('cleanup-removed')?.getAttribute('data-removed') ?? null");
      results["cleanupDialogs"] = dialogs.slice(askedBeforeCleanup);
      results["cleanupRunsAfter"] = await waitFor(`(() => { const n = Number(document.querySelector('#cleanup-summary [data-runs]')?.getAttribute('data-runs') ?? '-1'); return n >= 0 && n !== ${runsBefore} ? n : null; })()`, 20_000);
      results["cleanupFirstRunGone"] = !existsSync(join(SECOND, ".codaryn", "runs", String(firstRun)));
      results["cleanupForged"] = await js(`window.codaryn.applyCleanup(${JSON.stringify("0".repeat(32))})`);
      results["cleanupText"] = await js("document.getElementById('cleanup')?.textContent ?? ''");

      // 5j2. U-13 (DR-53): an apply run whose discarded files stay keeps its records. A plan run
      // (organize) discards sub/deeper/c.txt and is applied. A cleanup of the apply run's records only
      // (its not-reverted question answered "remove") keeps them as discarded_left and says so. With
      // its discarded files chosen too, R47-I4: "keep them" in the third dialog keeps both; agreeing to
      // delete them removes both.
      const beforeDiscard = await resultId();
      await taskWith("organize", "sub/deeper/c.txt를 폐기한다");
      const discardPlanId = await newResult(beforeDiscard, 90_000, "5j2 discard plan run");
      // U-178: the rest of 5j2 needs this plan run (a path from its id, its plan screen and apply); without it
      // the step is left out (stepFailures says why) and its checks fail alone.
      if (isRunIdValue(discardPlanId)) {
        // U-32 (UXM-14, U-14 AXM-2): with a records-changed mark (written here, as in 5i2) the pending plan
        // shows the warning first, no summary and no apply, and the main process gives it no approval
        // token, so nothing is asked. The test removes the mark it wrote; the plan is then applied as before.
        const discardMark = join(SECOND, ".codaryn", "runs", String(discardPlanId), "records-changed.json");
        writeFileSync(discardMark, "{}");
        await js("document.getElementById('run-view-plan')?.click(); true");
        await waitFor("(() => { const r = document.getElementById('plan')?.getAttribute('data-plan-ready'); return r && r !== 'none' ? r : null; })()");
        const askedMarked = dialogs.length;
        results["markedPlan"] = {
          first: await js("document.getElementById('plan')?.firstElementChild?.id ?? null"),
          apply: await js("document.getElementById('plan-apply') !== null"),
          cannotApply: await js("document.getElementById('plan-cannot-apply') !== null"),
          words: await js("document.getElementById('plan-agent-words') !== null"),
          approval: await js(`window.codaryn.plan(${JSON.stringify(secondHandle)}, ${JSON.stringify(discardPlanId)}, null, 'organize').then((r) => (r.ok ? r.approval : r.code))`),
          dialogs: dialogs.length - askedMarked,
        };
        unlinkSync(discardMark);
        await js("document.querySelector('[data-screen=\"run\"]')?.click(); true");
        await js("document.getElementById('run-view-plan')?.click(); true");
        await waitFor("(() => { const r = document.getElementById('plan')?.getAttribute('data-plan-ready'); return r && r !== 'none' && document.getElementById('plan-apply') !== null ? r : null; })()");
        await planCheckReady();
        await js("document.getElementById('plan-apply')?.click(); true");
        const discardApplyId = String(await newResult(discardPlanId, 90_000, "5j2 discard apply"));
        const discardBox = join(SECOND, ".codaryn", "discarded", discardApplyId);
        const discardRecords = join(SECOND, ".codaryn", "runs", discardApplyId);
        results["discardApplied"] = { fileGone: !existsSync(join(SECOND, "sub", "deeper", "c.txt")), box: existsSync(discardBox) };
        const cleanupOf = async (chooseDiscarded: boolean, keepThem = false): Promise<Record<string, unknown>> => {
          const asked = dialogs.length;
          await js("document.querySelector('[data-screen=\"cleanup\"]')?.click(); true");
          await waitFor("(() => { const r = document.getElementById('cleanup')?.getAttribute('data-cleanup-ready'); return r && r !== 'none' ? r : null; })()");
          const chosen = await js(
            `(() => { const run = document.querySelector('[data-run-select="${discardApplyId}"]'); const box = document.querySelector('[data-discarded-select="${discardApplyId}"]'); if (run === null || box === null) return false; run.checked = true; box.checked = ${chooseDiscarded}; document.getElementById('cleanup-preview').click(); return true; })()`,
          );
          const plan = await waitFor("document.getElementById('cleanup-plan')?.getAttribute('data-plan') ?? null");
          const warnings = await js(`document.querySelector('#cleanup-items [data-target="run"][data-id="${discardApplyId}"]')?.getAttribute('data-warnings') ?? null`);
          const planNotice = await js("document.getElementById('cleanup-plan-discarded-left') !== null");
          keepDiscarded = keepThem;
          await js("document.getElementById('cleanup-apply')?.click(); true");
          const result = await waitFor("document.getElementById('cleanup-result')?.getAttribute('data-result') ?? null");
          return {
            chosen,
            plan,
            warnings,
            planNotice,
            result,
            removed: await js("document.getElementById('cleanup-removed')?.getAttribute('data-removed') ?? null"),
            kept: await js("[...document.querySelectorAll('#cleanup-kept [data-reason]')].map((li) => [li.getAttribute('data-target'), li.getAttribute('data-reason')])"),
            keptText: await js("document.querySelector('#cleanup-kept [data-reason=\"discarded_left\"]')?.textContent ?? null"),
            keptNotice: await js("document.getElementById('cleanup-kept-discarded-left') !== null"),
            status: await js("document.getElementById('cleanup-result')?.getAttribute('data-status') ?? null"),
            dialogs: dialogs.slice(asked),
            left: { records: existsSync(discardRecords), box: existsSync(discardBox) },
          };
        };
        if (isRunIdValue(discardApplyId)) {
          results["discardLeftKept"] = await cleanupOf(false);
          results["discardLeftKeepBox"] = await cleanupOf(true, true);
          results["discardLeftBoth"] = await cleanupOf(true);
        }
      }

      // 5j3. U-22 (DR-48, R51-M-1): a cleanup that fails in part is shown as what it did. On Windows a file
      // of the analyze run's records held open stops the folder's move aside: kept as io_error, the
      // cleanup partly_failed, nothing of the run removed. The file is closed after (this test opened it).
      if (process.platform === "win32" && isRunIdValue(analyzeRunId)) {
        const records = join(SECOND, ".codaryn", "runs", analyzeRunId);
        const held = openSync(join(records, readdirSync(records).find((name) => name.endsWith(".jsonl")) ?? "journal.jsonl"), "r");
        try {
          const asked = dialogs.length;
          await js("document.querySelector('[data-screen=\"cleanup\"]')?.click(); true");
          await waitFor("(() => { const r = document.getElementById('cleanup')?.getAttribute('data-cleanup-ready'); return r && r !== 'none' ? r : null; })()");
          const chosen = await js(`(() => { const box = document.querySelector('[data-run-select="${analyzeRunId}"]'); if (box === null) return false; box.checked = true; document.getElementById('cleanup-preview').click(); return true; })()`);
          await waitFor("document.getElementById('cleanup-plan')?.getAttribute('data-plan') ?? null");
          await js("document.getElementById('cleanup-apply')?.click(); true");
          results["partlyFailed"] = {
            chosen,
            result: await waitFor("document.getElementById('cleanup-result')?.getAttribute('data-result') ?? null"),
            status: await js("document.getElementById('cleanup-result')?.getAttribute('data-status') ?? null"),
            notice: await js("document.getElementById('cleanup-status')?.getAttribute('data-status') ?? null"),
            errors: await js("document.querySelectorAll('#cleanup-result [data-error]').length"),
            removed: await js("document.getElementById('cleanup-removed')?.getAttribute('data-removed') ?? null"),
            kept: await js("[...document.querySelectorAll('#cleanup-kept [data-reason]')].map((li) => [li.getAttribute('data-target'), li.getAttribute('data-reason')])"),
            dialogs: dialogs.slice(asked),
            stays: existsSync(records),
          };
        } finally {
          closeSync(held);
        }
      } else {
        // U-178: on Windows without the analyze run (no run id) the step is left out; the check fails alone.
        results["partlyFailed"] = process.platform === "win32" ? `not measured: the analyze run gave no run id (${String(analyzeRunId)})` : "not measured on this platform";
      }

      // 5k. U-11 (3.11): the first-run guide on this workspace. The config file exists (used as it is), the
      // key is set (by its variable's name), init's suggestions for a package.json with a test script
      // are off until chosen; the chosen command is asked about by the main process (widening).
      writeFileSync(join(SECOND, "package.json"), JSON.stringify({ name: "smoke", scripts: { test: "node -e 0" } }));
      const setupPage = (): Promise<unknown> => waitFor("(() => { const s = document.getElementById('setup'); return s?.getAttribute('data-ready') === 'ok' ? s.getAttribute('data-step') : null; })()");
      await js("document.querySelector('[data-screen=\"setup\"]')?.click(); true");
      results["setupFolder"] = await setupPage();
      results["setupConfig"] = await js("document.getElementById('setup-config')?.getAttribute('data-config') ?? null");
      results["setupCreateAgain"] = await js("window.codaryn.createSettings(null)");
      results["setupCreateExists"] = await js("window.codaryn.createSettings(null)");
      await js("document.getElementById('setup-next')?.click(); true");
      results["setupModel"] = await setupPage();
      results["setupKey"] = await js("document.getElementById('setup-key')?.getAttribute('data-key') ?? null");
      await js("document.getElementById('setup-next')?.click(); true");
      results["setupPermissions"] = await setupPage();
      results["setupSuggestions"] = await js("[...document.querySelectorAll('[data-suggest]')].map((box) => [box.getAttribute('data-suggest'), box.getAttribute('data-label'), box.checked])");
      const askedBeforeSetup = dialogs.length;
      await js("(() => { for (const box of document.querySelectorAll('[data-suggest]')) box.checked = true; document.getElementById('setup-apply').click(); return true; })()");
      results["setupApplied"] = await waitFor("(() => { const o = document.getElementById('setup-applied'); return o?.hasAttribute('data-done') ? [...o.querySelectorAll('[data-result]')].map((li) => li.getAttribute('data-result')) : null; })()");
      results["setupDialogs"] = dialogs.slice(askedBeforeSetup);
      await js("document.getElementById('setup-next')?.click(); true");
      results["setupChecks"] = await setupPage();
      results["setupCheckItems"] = await js("document.querySelectorAll('#setup .checks li').length");
      results["setupOnDisk"] = (() => {
        try {
          const config = JSON.parse(readFileSync(process.env["CODARYN_CONFIG"] ?? "", "utf8")) as { policy?: { commands?: { executable: string; argsPrefix: string[] }[]; protectedPaths?: string[] } };
          return { npmTest: (config.policy?.commands ?? []).some((rule) => rule.executable === "npm" && rule.argsPrefix.join(" ") === "test"), packageJson: (config.policy?.protectedPaths ?? []).includes("package.json") };
        } catch {
          return "unreadable";
        }
      })();
      results["setupText"] = await js("document.getElementById('work')?.textContent ?? ''");
      // U-65 (3.3): setup made package.json a protected path; F5 in the file panel reads the tree again and marks it.
      const protectedBefore = await js("document.querySelectorAll('.tree [data-protected]').length");
      await js("document.querySelector('.tree')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true })); true");
      results["treeProtected"] = {
        before: protectedBefore,
        marked: await waitFor("[...document.querySelectorAll('.tree [data-protected=\"true\"] .name')].map((n) => n.textContent).join(',') || null", 20_000),
        note: await js("document.getElementById('tree-protected-note')?.hasAttribute('hidden') === false"),
      };

      // U-63 (3.5, GUI-D8): a task file's run. Its model is the scripted one (no request to the fake
      // API). The dialogs are answered by the test; no path reaches the page. A dialog closed without a
      // file starts nothing; a task file inside its workspace is refused by the app layer (S-1).
      const taskDir = join(GUI, "build", "smoke-task");
      mkdirSync(taskDir, { recursive: true });
      const taskSpec = (workspaceRoot: string) => ({
        schemaVersion: 1,
        id: "smoke-task-file",
        goal: "say that the task file ran",
        workflow: "document",
        workspaceRoot,
        model: { provider: "scripted", scriptPath: "./script.json" },
        policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
        privacy: { secretEnv: [] },
        // Within the config file's limits (a task may not go past them).
        limits: { maxModelTurns: 3, maxToolCalls: 3, maxTotalTokens: 50_000, maxDurationMs: 60_000 },
        verifiers: [],
      });
      writeFileSync(join(taskDir, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "the task file ran" }] }));
      writeFileSync(join(taskDir, "task.json"), JSON.stringify(taskSpec(SECOND)));
      writeFileSync(join(taskDir, "vars.env"), "SMOKE_TASK_VAR=1\n");
      writeFileSync(join(SECOND, "inside-task.json"), JSON.stringify(taskSpec(SECOND)));
      const taskHandle = JSON.stringify(second.ok ? second.handle : "");
      openAnswers.push(null);
      const cancelled = await js(`window.codaryn.startTaskRun(${taskHandle}, false)`);
      openAnswers.push(join(SECOND, "inside-task.json"));
      const inside = await js(`window.codaryn.startTaskRun(${taskHandle}, false)`);
      openAnswers.push(join(taskDir, "task.json"), join(taskDir, "vars.env"));
      await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
      await waitFor("document.getElementById('newtask')?.getAttribute('data-newtask-ready') ?? null");
      const beforeTask = await resultId();
      await js("(() => { document.getElementById('task-with-vars').checked = true; document.getElementById('task-run-file').click(); return true; })()");
      const taskRunId = await newResult(beforeTask, 60_000, "U-63 task file run");
      // U-178: "done" only for a run id (a wait's "timeout" or an "error:<code>" is shown as it is).
      const taskDone = isRunIdValue(taskRunId) && taskRunId !== beforeTask ? "done" : taskRunId;
      results["taskFileRun"] = {
        cancelled,
        inside,
        done: taskDone,
        result: await js("(() => { const r = document.getElementById('run-result'); return r === null ? null : { status: r.getAttribute('data-status'), reason: r.getAttribute('data-reason') }; })()"),
        place: await waitFor("(() => { const p = document.getElementById('run-task-steps')?.getAttribute('data-task-place'); return p && p !== 'checking' ? p : null; })()"),
        answersLeft: openAnswers.length,
        pathsOnPage: await js(`document.body.textContent.includes(${JSON.stringify(taskDir)})`),
      };
      unlinkSync(join(SECOND, "inside-task.json"));
      // U-92: the task file's run is listed but has no remembered form, so the main process refuses its review.
      await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
      await waitFor("(() => { const r = document.getElementById('runs-list')?.getAttribute('data-runs-ready'); return r && r !== 'loading' ? r : null; })()");
      results["reviewTaskRun"] = await js(`window.codaryn.review(${taskHandle}, ${JSON.stringify(taskRunId)}, null, null, 'accept', null).then((r) => (r.ok ? 'recorded' : r.code))`);

      // 6. What the page can and cannot do.
      // U-118 (3.7): the analyze run's records tab (the progress list's lines, its filter, its records-changed
      // mark); then, with a broken line added to its journal (after every step that reads it), the page is damaged.
      results["recordsTab"] = await (async () => {
        await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
        await waitFor("(() => { const r = document.getElementById('runs-list')?.getAttribute('data-runs-ready'); return r && r !== 'loading' ? r : null; })()");
        await js(`document.querySelector('[data-report="${analyzeRunId}"]')?.click(); true`);
        await waitFor("(() => { const r = document.getElementById('report')?.getAttribute('data-report-ready'); return r && r !== 'none' ? r : null; })()");
        await js("document.getElementById('report-tab-log')?.click(); true");
        const ready = await waitFor("(() => { const r = document.getElementById('report-log')?.getAttribute('data-log-ready'); return r && r !== 'loading' ? r : null; })()");
        const lines = Number(await js("document.querySelectorAll('#report-log li[data-kind]').length"));
        await js("(() => { const s = document.getElementById('report-log-filter'); if (!s) return false; s.value = 'checks'; s.dispatchEvent(new Event('change')); return true; })()");
        const kinds = (await js("[...document.querySelectorAll('#report-log li[data-kind]')].map((li) => li.getAttribute('data-kind'))")) as string[];
        const checks = kinds.length > 0 && kinds.length < lines && kinds.every((kind) => kind === "verifier_result" || kind === "integrity_checked");
        const recordsNote = await js("document.getElementById('report-log-records-changed') !== null");
        const notes = await js("document.getElementById('report-log-notes')?.children.length ?? -1");
        if (isRunIdValue(analyzeRunId)) appendFileSync(join(SECOND, ".codaryn", "runs", analyzeRunId, "journal.jsonl"), "{not a record\n");
        const damaged = await js(
          `window.codaryn.runEvents(${JSON.stringify(secondHandle)}, ${JSON.stringify(analyzeRunId)}, null, null, 0).then((r) => (r.ok ? { status: r.status, skipped: r.skipped, missing: r.missing, lines: r.items.length > 0 } : r.code), (e) => 'threw: ' + String(e && e.message))`,
        );
        const tab = await js("[document.getElementById('report')?.getAttribute('data-report-ready') ?? null, document.getElementById('report-tab-log') !== null, document.getElementById('report-log-notes')?.textContent ?? null]");
        return { ready, lines: lines > 0, checks, notes, recordsNote, damaged, ...(ready === "complete" ? {} : { tab }) };
      })();
      results["startsBlocked"] = startsBlocked;
      results["renderer"] = await js(
        "({ process: typeof process, require: typeof require, ipcRenderer: typeof ipcRenderer, module: typeof module, api: Object.keys(window.codaryn).sort().join(',') })",
      );
      const handle = second.ok ? second.handle : "";
      results["treePathString"] = await js(`window.codaryn.tree(${JSON.stringify(SECOND)}, null, 0)`);
      results["treeUnknownNode"] = await js(`window.codaryn.tree(${JSON.stringify(handle)}, ${JSON.stringify("0".repeat(32))}, 0)`);
      results["revealUnknown"] = await js(`window.codaryn.reveal(${JSON.stringify(handle)}, ${JSON.stringify("0".repeat(32))})`);
      results["doctorWithPath"] = await js(`window.codaryn.doctor(${JSON.stringify(SECOND)})`);
      // R-10 L-4: a link inside the built renderer that leads out of it (smoke.mjs makes one to the
      // temporary folder, another drive here) must not serve its script under the app's origin.
      results["linkedScript"] = await js("import('./outside-link/probe.js').then(() => 'loaded', () => 'blocked')");
      results["fetchHttp"] = await js("fetch('http://127.0.0.1:9/').then(() => 'reached', () => 'blocked')");
      results["fetchFile"] = await js("fetch('file:///C:/Windows/win.ini').then(() => 'reached', () => 'blocked')");
      results["windowOpen"] = await js("window.open('http://127.0.0.1:9/') === null ? 'blocked' : 'opened'");
      await js("location.href = 'http://127.0.0.1:9/'; true").catch(() => undefined);
      await sleep(500);
      results["urlAfterNavigation"] = contents.getURL();

      // 7. Processes, sockets and outside connections.
      const state = await host();
      results["hostNode"] = "host" in state ? state.host.nodeVersion : state.failure;
      results["hostPid"] = "host" in state ? (state.host.pid ?? null) : null;
      const metrics = app.getAppMetrics();
      const pids = new Set(metrics.map((metric) => metric.pid));
      if ("host" in state && state.host.pid !== undefined) pids.add(state.host.pid);
      results["processes"] = Object.fromEntries(
        [...pids].map((pid) => {
          const metric = metrics.find((m) => m.pid === pid);
          return [String(pid), metric === undefined ? "engine host (Node)" : `${metric.type}${metric.serviceName ? ` ${metric.serviceName}` : ""}`];
        }),
      );
      results["sockets"] = sockets([...pids]);
      // PM (a): the engine host's test transport refused no request to another machine in steps 1 to 7.
      results["transportRefused"] = "host" in state ? transportOf(await state.host.call("transport", {}, 10_000)) : state.failure;

      // U-64 (3.12, 4.4): the engine host ends (closed through its own handle, G-7). The window shows its
      // card, calls fail meanwhile, nothing restarts on its own, and the card's button starts a new host.
      const endedState = await host();
      const oldPid = "host" in endedState ? endedState.host.pid : undefined;
      if ("host" in endedState) await endedState.host.close();
      const engineCard = await waitFor("document.getElementById('engine-ended')?.hasAttribute('hidden') === false ? 'shown' : null", 20_000);
      const whileEnded = await js("window.codaryn.doctor(null).then((r) => (r.ok ? 'ok' : r.code))");
      await sleep(500);
      const stillEnded = await js("document.getElementById('status-engine')?.getAttribute('data-engine') ?? null");
      await js("document.getElementById('engine-restart')?.click(); true");
      const engineReady = await waitFor("document.getElementById('status-engine')?.getAttribute('data-engine') === 'ready' ? 'ready' : null", 30_000);
      const restartedState = await host();
      results["engineRestart"] = {
        card: engineCard,
        whileEnded,
        stillEnded,
        ready: engineReady,
        newHost: "host" in restartedState && restartedState.host.pid !== undefined && restartedState.host.pid !== oldPid,
        cardHidden: await js("document.getElementById('engine-ended')?.hasAttribute('hidden') === true"),
        doctorAfter: await js("window.codaryn.doctor(null).then((r) => (r.ok ? 'ok' : r.code))"),
        again: await js("window.codaryn.restartEngine().then((r) => (r.ok ? 'restarted' : r.code))"),
      };

      // U-124 (3.6, DR-3): a run with the profile "ask" calls the command its confirm rule asks about, twice;
      // the main process asks (the test answers for the OS dialog): the first allowed once, the second denied.
      results["permissionQuestion"] = await (async () => {
        permissionAnswers.push("allow_once", "deny");
        await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
        await waitFor("document.getElementById('newtask')?.getAttribute('data-newtask-ready') ?? null");
        const before = await js("document.getElementById('run-result-id')?.textContent ?? null");
        await pressRun("profile ask", "document.getElementById('task-workflow').value = ''; document.getElementById('task-profile').value = 'ask'; const g = document.getElementById('task-goal'); g.value = 'ask before running';");
        const ended = await waitFor(`(() => { const id = document.getElementById('run-result-id')?.textContent ?? null; return id !== null && id !== ${JSON.stringify(before)} ? id : null; })()`, 90_000);
        const asked = join(SECOND, "asked.txt");
        return {
          questions: questionsSeen.map((q) => ({ id: q.id, tool: q.tool, permission: q.permission, subject: q.subject.split(/[\\/]/).pop(), argumentCount: q.argumentCount })),
          ran: existsSync(asked) ? readFileSync(asked, "utf8") : null,
          lines: await js("[...document.querySelectorAll('[id^=\"run-question-\"]')].map((p) => p.id)"),
          pageCanAnswer: await js("Object.keys(window.codaryn).some((name) => /answer|permission|question/i.test(name))"),
          ended: typeof ended === "string" && ended !== "timeout",
        };
      })();

      // U-206 (U-196, DR-69 B-3): a run plan, copied in after every step that lists this workspace's runs,
      // opened from the run list. The window shows its files and summary and keeps apply off; through the
      // page's own API, the main process refuses its apply before any dialog and passes the check's code on.
      results["runPlan"] = await (async () => {
        if (RUN_PLAN === "") return null;
        const runId = basename(RUN_PLAN);
        cpSync(RUN_PLAN, join(SECOND, ".codaryn", "runs", runId), { recursive: true });
        const asked = dialogs.length;
        await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
        await waitFor("(() => { const r = document.getElementById('runs-list')?.getAttribute('data-runs-ready'); return r && r !== 'loading' ? r : null; })()");
        await js(`document.querySelector('[data-plan="${runId}"]')?.click(); true`);
        const shown = await waitFor("(() => { const r = document.getElementById('plan')?.getAttribute('data-plan-ready'); return r && r !== 'none' ? r : null; })()");
        const screen = (await js(
          "({ files: [...document.querySelectorAll('#plan-files li')].map((li) => [li.getAttribute('data-change'), li.textContent.split(': ').pop()]), kind: document.getElementById('plan-summary')?.getAttribute('data-plan-kind') ?? null, approved: document.getElementById('plan-agent-words')?.getAttribute('data-approved') ?? null, words: document.getElementById('plan-agent-words-text')?.textContent ?? null, moves: document.getElementById('plan-actions') !== null, unknown: document.getElementById('plan-form-unknown') !== null, apply: document.getElementById('plan-apply') !== null, check: document.getElementById('plan-check') !== null })",
        )) as Record<string, unknown>;
        const viaApi = (await js(
          `window.codaryn.plan(${JSON.stringify(secondHandle)}, ${JSON.stringify(runId)}, null, null).then(async (r) => { if (!r.ok) return { plan: r.code }; const apply = await window.codaryn.applyPlan(r.approval, false); const consent = await window.codaryn.applyPlan(r.approval, true); const checked = await window.codaryn.checkPlan(r.approval); return { planKind: r.view.planKind ?? null, fileCount: (r.view.files ?? []).length, digest: r.view.digest, approval: typeof r.approval, applied: apply.ok ? 'started' : apply.code, consent: consent.ok ? 'started' : consent.code, checked: checked.ok ? 'checked' : checked.code }; })`,
        )) as Record<string, unknown>;
        return { shown, ...screen, ...viaApi, dialogs: dialogs.slice(asked) };
      })();

      // U-226 (U-218, DR-69 B-3): a run plan applied from the window. A plan run with the task type
      // "rewrite" (plan "run"; its model names planned.md), its plan checked and applied after the main
      // process's run plan dialog; the run that carries it out writes planned.md and is refused
      // unplanned.md. A second token of the same plan, taken before the apply (as another window could
      // hold one), is refused afterwards as already applied; the plan screen says which run applied it.
      results["runPlanApply"] = await (async () => {
        const before = await resultId();
        await taskWith("rewrite", "planned.md를 만드는 계획을 세운다");
        const planRunId = await newResult(before, 90_000, "U-226 plan run");
        if (!isRunIdValue(planRunId)) return { planRun: planRunId };
        const planReason = await js("document.getElementById('run-result')?.getAttribute('data-reason') ?? null");
        await js("document.getElementById('run-view-plan')?.click(); true");
        const shown = await waitFor("(() => { const r = document.getElementById('plan')?.getAttribute('data-plan-ready'); return r && r !== 'none' ? r : null; })()");
        const check = await planCheckReady();
        const spare = await js(`window.codaryn.plan(${JSON.stringify(secondHandle)}, ${JSON.stringify(planRunId)}, null, 'rewrite').then((r) => (r.ok ? r.approval : null))`);
        const asked = dialogs.length;
        await js("document.getElementById('plan-apply')?.click(); true");
        const carryId = await newResult(planRunId, 90_000, "U-226 carry run");
        const result = (await js(
          "(() => { const r = document.getElementById('run-result'); return r === null ? null : { status: r.getAttribute('data-status'), reason: r.getAttribute('data-reason'), notices: [...document.querySelectorAll('#run-notices li')].map((li) => li.textContent), carried: document.getElementById('run-carried-plan')?.textContent ?? null, refused: document.getElementById('run-denied-not-planned')?.textContent ?? null, hint: document.getElementById('run-denied-not-planned-hint') !== null }; })()",
        )) as { status: string | null; reason: string | null; notices: string[]; carried: string | null; refused: string | null; hint: boolean } | null;
        const again = typeof spare === "string" ? await js(`window.codaryn.applyPlan(${JSON.stringify(spare)}, false).then((r) => (r.ok ? 'started' : r.code))`) : "no spare token";
        await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
        await waitFor("(() => { const r = document.getElementById('runs-list')?.getAttribute('data-runs-ready'); return r && r !== 'loading' ? r : null; })()");
        // U-226 (U-221): the plan run's row names the run that carried its plan out, in the carried words.
        const row = (await js(
          `(() => { const mark = document.querySelector('[data-plan="${planRunId}"]')?.parentElement?.querySelector('.plan-apply'); return mark ? { carried: mark.getAttribute('data-plan-carried'), text: mark.textContent } : null; })()`,
        )) as { carried: string | null; text: string | null } | null;
        // U-244: the carrying run's own row names the plan run it carried out; apply rows name theirs.
        const planOf = (await js(
          `(() => { const carry = document.querySelector('[data-run="${String(carryId)}"] [data-plan-of-kind="carried"]'); return { carried: carry ? carry.getAttribute('data-plan-of') : null, applies: document.querySelectorAll('[data-plan-of-kind="apply"]').length }; })()`,
        )) as { carried: string | null; applies: number };
        await js(`document.querySelector('[data-plan="${planRunId}"]')?.click(); true`);
        const after = await waitFor("(() => { const r = document.getElementById('plan')?.getAttribute('data-plan-ready'); return r && r !== 'none' ? r : null; })()");
        const appliedBy = await js("document.getElementById('plan-applied')?.textContent ?? null");
        const appliedCarried = await js("document.getElementById('plan-applied')?.getAttribute('data-carried') ?? null");
        const planned = join(SECOND, "planned.md");
        return {
          planReason,
          shown,
          check,
          carried: isRunIdValue(carryId) && carryId !== planRunId,
          status: result?.status ?? null,
          reason: result?.reason ?? null,
          namesPlan: typeof result?.carried === "string" && result.carried.includes(planRunId),
          refused: Number(/\d+/.exec(result?.refused ?? "")?.[0] ?? "-1"),
          hint: result?.hint ?? null,
          planned: existsSync(planned) ? readFileSync(planned, "utf8") : null,
          unplanned: existsSync(join(SECOND, "unplanned.md")),
          again,
          after,
          appliedByCarry: typeof appliedBy === "string" && isRunIdValue(carryId) && appliedBy.includes(carryId),
          appliedCarried,
          rowCarried: row !== null && row.carried === "true" && typeof row.text === "string" && isRunIdValue(carryId) && row.text.includes(carryId),
          carryRowNamesPlan: planOf.carried === planRunId,
          applyRowsNamePlans: planOf.applies >= 1,
          dialogs: dialogs.slice(asked),
        };
      })();

      // U-247 (bundle A, proposal P-4) and U-212: analyze-private chosen before the config has an unreadable
      // path says what it needs and that the config's command rule (5b2) is in the way; its start is refused
      // (the command rule first: invalid_config, no hint without unreadable paths, as the CLI). The settings
      // screen adds an unreadable path (an alert: command rules with it); analyze-private is then refused with
      // the CLI's reason in words (unreadable_with_commands); k is set and unset (a widening, asked), and the
      // path removed (a widening, asked), so the config is as before for step 8. Every start here is refused
      // when the task type is resolved, before any model request.
      results["privateData"] = await (async () => {
        let builtin = false;
        const chooseAnalyzePrivate = async (): Promise<{ shown: boolean; needs: boolean; commands: boolean }> => {
          await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
          await waitFor("document.getElementById('newtask')?.getAttribute('data-newtask-ready') ?? null");
          const options = await js("[...document.querySelectorAll('#task-workflow option')].map((o) => o.value)");
          builtin = Array.isArray(options) && options.includes("analyze-private");
          await js("(() => { const w = document.getElementById('task-workflow'); w.value = 'analyze-private'; w.dispatchEvent(new Event('change')); return true; })()");
          return (await js(
            "({ shown: document.getElementById('task-private-notice')?.hasAttribute('hidden') === false, needs: document.getElementById('task-private-needs-unreadable') !== null, commands: document.getElementById('task-private-commands') !== null })",
          )) as { shown: boolean; needs: boolean; commands: boolean };
        };
        const startRefused = async (): Promise<unknown> => {
          await pressRun("analyze-private", "const g = document.getElementById('task-goal'); g.value = 'count the rows';");
          return waitFor("(() => { const e = document.querySelector('#run-end [data-error]'); return e ? { code: e.getAttribute('data-error'), hint: e.getAttribute('data-hint'), text: e.textContent } : null; })()", 30_000);
        };
        const before = await chooseAnalyzePrivate();
        const refused = await startRefused();
        const asked = dialogs.length;
        await js("document.querySelector('[data-screen=\"settings\"]')?.click(); true");
        await waitFor("document.getElementById('settings')?.getAttribute('data-settings-ready') ?? null");
        const section = await js("document.getElementById('settings-private') !== null");
        const settle = (): Promise<unknown> =>
          waitFor("(() => { const ready = document.getElementById('settings')?.getAttribute('data-settings-ready'); const p = document.getElementById('settings-proposal')?.getAttribute('data-proposal'); return ready === 'ok' && p === 'written' ? 'written' : p === 'not_confirmed' || p === 'error' ? p : null; })()");
        const proposed = (): Promise<unknown> =>
          waitFor("(() => { const p = document.getElementById('settings-proposal')?.getAttribute('data-proposal'); return p && p !== 'asking' ? [p, [...document.querySelectorAll('#settings-proposal .widening [data-kind]')].map((li) => li.getAttribute('data-kind'))] : null; })()");
        const paths = (): Promise<unknown> => js("[...document.querySelectorAll('#settings-unreadable li > span:first-child')].map((s) => s.textContent)");
        await js("(() => { document.getElementById('settings-unreadable-path').value = 'private-data'; document.getElementById('settings-unreadable-add').click(); return true; })()");
        const addProposal = await proposed();
        await js("document.getElementById('settings-write')?.click(); true");
        const added = { written: await settle(), paths: await paths(), alert: await js("document.getElementById('settings-unreadable-commands')?.getAttribute('role') ?? null") };
        await js("(() => { document.getElementById('settings-min-group-size-input').value = '10'; document.getElementById('settings-min-group-size-set').click(); return true; })()");
        const raiseProposal = await proposed();
        await js("document.getElementById('settings-write')?.click(); true");
        const raised = { written: await settle(), k: await js("document.getElementById('settings-min-group-size')?.getAttribute('data-configured') ?? null") };
        const noticeWith = await chooseAnalyzePrivate();
        const refusedWith = await startRefused();
        await js("document.querySelector('[data-screen=\"settings\"]')?.click(); true");
        await waitFor("document.getElementById('settings')?.getAttribute('data-settings-ready') ?? null");
        await js("document.getElementById('settings-min-group-size-unset')?.click(); true");
        const lowerProposal = await proposed();
        await js("document.getElementById('settings-write')?.click(); true");
        const lowered = { written: await settle(), k: await js("document.getElementById('settings-min-group-size')?.getAttribute('data-configured') ?? null") };
        await js("document.querySelector('#settings-unreadable [data-remove]')?.click(); true");
        const removeProposal = await proposed();
        await js("document.getElementById('settings-write')?.click(); true");
        const removed = { written: await settle(), paths: await paths() };
        return { builtin, before, refused, section, addProposal, added, raiseProposal, raised, noticeWith, refusedWith, lowerProposal, lowered, removeProposal, removed, dialogs: dialogs.slice(asked) };
      })();

      // 8. GU-3: closing the window while a run goes on asks (answered "cancel and close" here),
      // cancels, waits for the end and closes. Last, because the window is gone afterwards.
      await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
      await waitFor("document.getElementById('newtask')?.getAttribute('data-newtask-ready') ?? null");
      const beforeClose = messagesReceived();
      await pressRun("close while running", "const g = document.getElementById('task-goal'); g.value = 'close while running';");
      await waitFor("document.getElementById('run-cancel')?.hasAttribute('disabled') === false ? 'ready' : null", 60_000);
      // R29-L1: closed only once this run's model request reached the fake API.
      results["closeRequestArrived"] = await requestArrived(beforeClose);
      const closed = new Promise<void>((resolve) => window.once("closed", () => resolve()));
      const begin = Date.now();
      window.close();
      await Promise.race([closed, sleep(30_000)]);
      results["closeGuard"] = { dialogs: [...dialogs], closed: window.isDestroyed(), ms: Date.now() - begin };
      // 6.9: every end notification is the fixed text with a status word, nothing of a goal or a path.
      results["endNotices"] = notices.map((notice) => notice.body);
      // And none in step 8 either, while the host still runs.
      const after = await host();
      results["transportRefusedEnd"] = "host" in after && !after.host.exited ? transportOf(await after.host.call("transport", {}, 10_000)) : "host ended";
    } catch (error) {
      results["error"] = error instanceof Error ? error.message : String(error);
    } finally {
      writeFileSync(RESULT, `${JSON.stringify(results, null, 2)}\n`);
      app.quit();
    }
  },
});
