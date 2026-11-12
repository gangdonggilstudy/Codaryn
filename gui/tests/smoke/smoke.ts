/**
 * GU-1 smoke test: the real Electron app with the real engine host (DR-26). Started by
 * scripts/build/smoke.mjs as `electron build/tests/smoke/smoke.js`; never part of the product
 * entry (main.ts). It waits for the window to show the checks, probes the renderer's isolation
 * and the blocked requests (loopback addresses only, nothing leaves the machine), counts listening
 * sockets of the app's processes, writes what it saw to build/smoke-result.json and quits.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { startGui } from "../../src/main/app.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const RESULT = join(GUI, "build", "smoke-result.json");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Endpoint {
  readonly proto: string;
  readonly address: string;
  readonly port: number;
  readonly pid: number;
}

/** Listening TCP sockets and bound UDP endpoints owned by these processes (Windows PowerShell). */
function listening(pids: readonly number[]): { tcp: number; udp: number; endpoints: Endpoint[] } | string {
  if (process.platform !== "win32") return "not measured on this platform";
  const powershell = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const list = pids.join(",");
  const script = [
    `$p = @(${list})`,
    "$t = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $p -contains $_.OwningProcess } | ForEach-Object { 'tcp ' + $_.LocalAddress + ' ' + $_.LocalPort + ' ' + $_.OwningProcess })",
    "$u = @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $p -contains $_.OwningProcess } | ForEach-Object { 'udp ' + $_.LocalAddress + ' ' + $_.LocalPort + ' ' + $_.OwningProcess })",
    "($t + $u) -join \"`n\"",
  ].join("; ");
  const out = execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true }).trim();
  const endpoints = out
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [proto, address, port, pid] = line.trim().split(" ");
      return { proto: proto ?? "?", address: address ?? "?", port: Number(port), pid: Number(pid) };
    });
  return { tcp: endpoints.filter((e) => e.proto === "tcp").length, udp: endpoints.filter((e) => e.proto === "udp").length, endpoints };
}

const workspace = mkdtempSync(join(tmpdir(), "codaryn-gui-smoke-"));
const results: Record<string, unknown> = {};

startGui({
  guiRoot: GUI,
  userDataDir: join(GUI, "build", "smoke-profile"),
  async afterLoad({ window, host, issueWorkspace }) {
    try {
      const contents = window.webContents;
      const js = (code: string): Promise<unknown> => contents.executeJavaScript(code, true);
      const waitForChecks = async (): Promise<unknown> => {
        for (let i = 0; i < 600; i += 1) {
          const state = await js("document.querySelector('[data-doctor-ready]')?.getAttribute('data-doctor-ready') ?? null");
          if (state !== null) return state;
          await sleep(100);
        }
        return "timeout";
      };

      results["doctorWithoutWorkspace"] = await waitForChecks();
      results["checksShown"] = await js("document.querySelectorAll('.checks li').length");
      results["overall"] = await js("document.querySelector('.overall')?.getAttribute('data-status') ?? null");
      results["lang"] = await js("document.documentElement.lang");
      results["url"] = contents.getURL();
      results["renderer"] = await js(
        "({ process: typeof process, require: typeof require, ipcRenderer: typeof ipcRenderer, module: typeof module, api: Object.keys(window.codaryn).sort().join(',') })",
      );

      // A workspace as the folder dialog would give it, then the same IPC path as a click.
      const handle = issueWorkspace(workspace);
      results["doctorWithWorkspace"] = await js(
        `window.codaryn.doctor(${JSON.stringify(handle)}).then((r) => r.ok ? { ok: true, workspaceName: r.workspaceName, workspaceCheck: r.view.checks.find((c) => c.id === "workspace")?.status ?? null } : r)`,
      );
      results["doctorWithPath"] = await js(`window.codaryn.doctor(${JSON.stringify(workspace)})`);
      results["doctorUnknownHandle"] = await js(`window.codaryn.doctor(${JSON.stringify("0".repeat(32))})`);

      // Blocked requests and navigation: loopback addresses only. CODARYN_SMOKE_NO_PROBES=1 leaves them out
      // (to see what the window alone opens).
      const probes = process.env["CODARYN_SMOKE_NO_PROBES"] !== "1";
      results["socketsBeforeProbes"] = listening([...new Set([...app.getAppMetrics().map((metric) => metric.pid)])]);
      if (probes) results["fetchHttp"] = await js("fetch('http://127.0.0.1:9/').then(() => 'reached', () => 'blocked')");
      if (probes) results["fetchFile"] = await js("fetch('file:///C:/Windows/win.ini').then(() => 'reached', () => 'blocked')");
      if (probes) results["windowOpen"] = await js("window.open('http://127.0.0.1:9/') === null ? 'blocked' : 'opened'");
      if (probes) await js("location.href = 'http://127.0.0.1:9/'; true").catch(() => undefined);
      await sleep(500);
      results["urlAfterNavigation"] = contents.getURL();

      const state = await host();
      results["hostNode"] = "host" in state ? state.host.nodeVersion : state.failure;
      const metrics = app.getAppMetrics();
      const pids = new Set(metrics.map((metric) => metric.pid));
      if ("host" in state && state.host.pid !== undefined) pids.add(state.host.pid);
      results["processes"] = Object.fromEntries(
        [...pids].map((pid) => {
          const metric = metrics.find((m) => m.pid === pid);
          return [String(pid), metric === undefined ? "engine host (Node)" : `${metric.type}${metric.serviceName ? ` ${metric.serviceName}` : ""}`];
        }),
      );
      results["listening"] = listening([...pids]);
    } catch (error) {
      results["error"] = error instanceof Error ? error.message : String(error);
    } finally {
      writeFileSync(RESULT, `${JSON.stringify(results, null, 2)}\n`);
      rmSync(workspace, { recursive: true, force: true });
      app.quit();
    }
  },
});
