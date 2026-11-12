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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { startGui } from "../../src/main/app.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const RESULT = join(GUI, "build", "smoke-result.json");
const STATE = join(GUI, "build", "smoke-state", "gui-state.json");
const SECOND = process.env["CODARYN_SMOKE_SECOND"] ?? "";

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
/** PM (a): the engine host's answer to "transport" (its mode and how many requests it refused). */
const transportOf = (response: { readonly ok: boolean; readonly value?: unknown; readonly error?: { readonly code: string } }): unknown => (response.ok ? response.value : response.error?.code);
/** The main process's OS dialogs this test answered, by id. */
const dialogs: string[] = [];
/** GU-6: answer the next widening dialog with "do not write". */
let refuseWidening = false;

startGui({
  // R21-I-3: the engine host reaches this machine only (the loopback fake API); never a real API.
  loopbackOnly: true,
  guiRoot: GUI,
  userDataDir: join(GUI, "build", "smoke-profile"),
  stateFile: STATE,
  answerDialog: async (id) => {
    dialogs.push(id);
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
        for (let waited = 0; waited < ms; waited += 100) {
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

      // 5c. GU-3: a run from the new task screen (the fake API asks to read a.txt, then ends).
      const startTask = async (goal: string): Promise<void> => {
        await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
        await waitFor("document.getElementById('newtask')?.getAttribute('data-newtask-ready') ?? null");
        await js(`(() => { const g = document.getElementById('task-goal'); g.value = ${JSON.stringify(goal)}; document.getElementById('task-run').click(); return true; })()`);
      };
      await startTask("a.txt를 읽고 요약한다");
      results["runDone"] = await waitFor("document.querySelector('#work')?.getAttribute('data-run-phase') === 'done' ? 'done' : null", 90_000);
      results["runResult"] = await js(
        "(() => { const r = document.getElementById('run-result'); return r === null ? null : { status: r.getAttribute('data-status'), reason: r.getAttribute('data-reason'), runId: document.getElementById('run-result-id')?.textContent ?? null }; })()",
      );
      results["runLog"] = await js("[...document.querySelectorAll('#run-log li')].map((li) => li.getAttribute('data-kind'))");
      results["runCounts"] = await js("document.getElementById('run-counts')?.textContent ?? null");
      results["runText"] = await js("document.getElementById('work')?.textContent ?? ''");
      results["runAgainWhileIdle"] = await js("window.codaryn.cancelRun()");

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
      const newResult = (previous: unknown, ms = 90_000): Promise<unknown> =>
        waitFor(`(() => { const id = document.getElementById('run-result-id')?.textContent ?? null; return id !== null && id !== ${JSON.stringify(previous)} ? id : null; })()`, ms);
      const taskWith = async (workflow: string, goal: string): Promise<void> => {
        await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
        await waitFor("document.getElementById('newtask')?.getAttribute('data-newtask-ready') ?? null");
        await js(`(() => { document.getElementById('task-workflow').value = ${JSON.stringify(workflow)}; const g = document.getElementById('task-goal'); g.value = ${JSON.stringify(goal)}; document.getElementById('task-run').click(); return true; })()`);
      };
      // A: the task kind chosen directly (R-14 L-3, R21-M-1): the plan view, its apply and the
      // file moved, through the task form's workflowRef.
      const beforeDirect = await resultId();
      await taskWith("organize", "a.txt를 moved 폴더로 옮긴다");
      const directRunId = await newResult(beforeDirect);
      await js("document.getElementById('run-view-plan')?.click(); true");
      results["directPlanShown"] = await waitFor("(() => { const r = document.getElementById('plan')?.getAttribute('data-plan-ready'); return r && r !== 'none' ? r : null; })()");
      await js("document.getElementById('plan-apply')?.click(); true");
      await newResult(directRunId);
      results["applyByWorkflow"] = await js(
        "(() => { const r = document.getElementById('run-result'); return r === null ? null : { status: r.getAttribute('data-status'), reason: r.getAttribute('data-reason'), applied: document.querySelectorAll('#run-applied li').length }; })()",
      );
      results["applyByWorkflowMoved"] = { from: existsSync(join(SECOND, "a.txt")), to: existsSync(join(SECOND, "moved", "a.txt")) };

      // B: through a profile whose workflowRef is organize: the plan's apply takes the same profile.
      const beforePlan = await resultId();
      await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
      await waitFor("document.getElementById('newtask')?.getAttribute('data-newtask-ready') ?? null");
      await js("(() => { document.getElementById('task-workflow').value = ''; document.getElementById('task-profile').value = 'tidy'; const g = document.getElementById('task-goal'); g.value = 'sub/b.txt를 moved 폴더로 옮긴다'; document.getElementById('task-run').click(); return true; })()");
      const planRunId = (await newResult(beforePlan)) as string;
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
      await js("document.getElementById('plan-apply')?.click(); true");
      await newResult(planRunId);
      results["applyDone"] = await js(
        "(() => { const r = document.getElementById('run-result'); return r === null ? null : { status: r.getAttribute('data-status'), reason: r.getAttribute('data-reason'), applied: document.querySelectorAll('#run-applied li').length }; })()",
      );
      results["applyMoved"] = { from: existsSync(join(SECOND, "sub", "b.txt")), to: existsSync(join(SECOND, "moved", "b.txt")) };
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
      await newResult(beforeReview);
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
      await js("document.querySelector('#report [role=tab][data-tab=\"review\"]')?.click(); true");
      results["reportVerdict"] = await js("document.getElementById('report-verdict')?.getAttribute('data-verdict') ?? null");
      results["reportText"] = await js("document.getElementById('report')?.textContent ?? ''");
      // From the run list: the first run's report (it created made.txt, since reverted).
      await js("document.querySelector('[data-screen=\"runs\"]')?.click(); true");
      await waitFor("(() => { const r = document.getElementById('runs-list')?.getAttribute('data-runs-ready'); return r && r !== 'loading' ? r : null; })()");
      await js(`document.querySelector('[data-report="${firstRun}"]')?.click(); true`);
      results["listReport"] = await waitFor(
        "(() => { const r = document.getElementById('report')?.getAttribute('data-report-ready'); return r && r !== 'none' ? (document.getElementById('report-status')?.getAttribute('data-reason') ?? r) : null; })()",
      );

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
      results["cleanupRemoved"] = await js("document.getElementById('cleanup-removed')?.getAttribute('data-removed') ?? null");
      results["cleanupDialogs"] = dialogs.slice(askedBeforeCleanup);
      results["cleanupRunsAfter"] = await waitFor(`(() => { const n = Number(document.querySelector('#cleanup-summary [data-runs]')?.getAttribute('data-runs') ?? '-1'); return n >= 0 && n !== ${runsBefore} ? n : null; })()`, 20_000);
      results["cleanupFirstRunGone"] = !existsSync(join(SECOND, ".codaryn", "runs", String(firstRun)));
      results["cleanupForged"] = await js(`window.codaryn.applyCleanup(${JSON.stringify("0".repeat(32))})`);
      results["cleanupText"] = await js("document.getElementById('cleanup')?.textContent ?? ''");

      // 6. What the page can and cannot do.
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

      // 8. GU-3: closing the window while a run goes on asks (answered "cancel and close" here),
      // cancels, waits for the end and closes. Last, because the window is gone afterwards.
      await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
      await waitFor("document.getElementById('newtask')?.getAttribute('data-newtask-ready') ?? null");
      const beforeClose = messagesReceived();
      await js("(() => { const g = document.getElementById('task-goal'); g.value = 'close while running'; document.getElementById('task-run').click(); return true; })()");
      await waitFor("document.getElementById('run-cancel')?.hasAttribute('disabled') === false ? 'ready' : null", 60_000);
      // R29-L1: closed only once this run's model request reached the fake API.
      results["closeRequestArrived"] = await requestArrived(beforeClose);
      const closed = new Promise<void>((resolve) => window.once("closed", () => resolve()));
      const begin = Date.now();
      window.close();
      await Promise.race([closed, sleep(30_000)]);
      results["closeGuard"] = { dialogs: [...dialogs], closed: window.isDestroyed(), ms: Date.now() - begin };
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
