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
/** The main process's OS dialogs this test answered, by id. */
const dialogs: string[] = [];

startGui({
  guiRoot: GUI,
  userDataDir: join(GUI, "build", "smoke-profile"),
  stateFile: STATE,
  answerDialog: async (id) => {
    dialogs.push(id);
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
      await startTask("멈추는 작업");
      results["cancelReady"] = await waitFor("document.getElementById('run-cancel')?.hasAttribute('disabled') === false ? 'ready' : null", 60_000);
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

      // 5e'. DR-29: the first run's changed file by path and state (it was reverted, so it is gone now).
      await waitFor(`document.querySelector('[data-changes="${firstRun}"]') !== null ? 'ready' : null`, 30_000);
      await js(`document.querySelector('[data-changes="${firstRun}"]')?.click(); true`);
      results["changesShown"] = await waitFor("(() => { const r = document.getElementById('changes')?.getAttribute('data-changes-ready'); return r && r !== 'none' ? r : null; })()");
      results["changesRows"] = await js("[...document.querySelectorAll('#changes-files li')].map((li) => ({ state: li.getAttribute('data-state'), created: li.getAttribute('data-created'), path: li.querySelector('.path')?.textContent ?? null }))");
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
      // A: the task kind chosen directly. The app layer's task form has no workflow, so the apply
      // cannot name organize (reported to the PM); the window shows the error.
      const beforeDirect = await resultId();
      await taskWith("organize", "a.txt를 moved 폴더로 옮긴다");
      await newResult(beforeDirect);
      await js("document.getElementById('run-view-plan')?.click(); true");
      await waitFor("(() => { const r = document.getElementById('plan')?.getAttribute('data-plan-ready'); return r && r !== 'none' ? r : null; })()");
      await js("document.getElementById('plan-apply')?.click(); true");
      results["applyByWorkflow"] = await waitFor("document.querySelector('#plan-message [data-error]')?.getAttribute('data-error') ?? null", 60_000);

      // B: the same through a profile whose workflowRef is organize: the plan's apply takes the same profile.
      const beforePlan = await resultId();
      await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
      await waitFor("document.getElementById('newtask')?.getAttribute('data-newtask-ready') ?? null");
      await js("(() => { document.getElementById('task-workflow').value = ''; document.getElementById('task-profile').value = 'tidy'; const g = document.getElementById('task-goal'); g.value = 'a.txt를 moved 폴더로 옮긴다'; document.getElementById('task-run').click(); return true; })()");
      const planRunId = (await newResult(beforePlan)) as string;
      results["planRun"] = await js("document.getElementById('run-result')?.getAttribute('data-reason') ?? null");
      await js("document.getElementById('run-view-plan')?.click(); true");
      results["planShown"] = await waitFor("(() => { const r = document.getElementById('plan')?.getAttribute('data-plan-ready'); return r && r !== 'none' ? r : null; })()");
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
      results["applyMoved"] = { from: existsSync(join(SECOND, "a.txt")), to: existsSync(join(SECOND, "moved", "a.txt")) };

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

      // 8. GU-3: closing the window while a run goes on asks (answered "cancel and close" here),
      // cancels, waits for the end and closes. Last, because the window is gone afterwards.
      await js("document.querySelector('[data-screen=\"newtask\"]')?.click(); true");
      await waitFor("document.getElementById('newtask')?.getAttribute('data-newtask-ready') ?? null");
      await js("(() => { const g = document.getElementById('task-goal'); g.value = 'close while running'; document.getElementById('task-run').click(); return true; })()");
      await waitFor("document.getElementById('run-cancel')?.hasAttribute('disabled') === false ? 'ready' : null", 60_000);
      const closed = new Promise<void>((resolve) => window.once("closed", () => resolve()));
      const begin = Date.now();
      window.close();
      await Promise.race([closed, sleep(30_000)]);
      results["closeGuard"] = { dialogs: [...dialogs], closed: window.isDestroyed(), ms: Date.now() - begin };
    } catch (error) {
      results["error"] = error instanceof Error ? error.message : String(error);
    } finally {
      writeFileSync(RESULT, `${JSON.stringify(results, null, 2)}\n`);
      app.quit();
    }
  },
});
