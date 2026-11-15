import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCodarynApp } from "../../../src/app/index.js";
import { runReport } from "../../../src/cli/report.js";
import { listRuns } from "../../../src/store/index.js";
import { appEnvironment, setupRun, taskRequest, WRITE_NOTES } from "../app/support.js";

test("DR-77 CLI: explicit environment/OS language, English default adapter, same JSON and records", async () => {
  const base = await setupRun({}, {}, [WRITE_NOTES, { text: "original model words" }]);
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base)); assert.ok(started.ok);
  assert.ok((await started.handle.done).ok);
  const workspace = path.join(base, "work"), runId = started.handle.runId;
  const files = ["result.json", "journal.jsonl"].map(name => path.join(workspace, ".codaryn", "runs", runId, name));
  const before = await Promise.all(files.map(file => readFile(file)));
  const argv = ["report", "--workspace", workspace, "--run", runId];
  const io = { argv, cwd: base, env: { CODARYN_LANG: "ko" }, listRuns };
  const absent = await runReport(io), en = await runReport({ ...io, language: "en" }), ko = await runReport({ ...io, language: "ko" });
  assert.deepEqual(absent, en, "direct callers still default to English, independently of env");
  assert.ok("text" in en && "text" in ko);
  assert.ok(en.text.startsWith("# Codaryn run report\n")); assert.ok(ko.text.startsWith("# Codaryn 실행 보고서\n"));
  assert.equal(ko.exitCode, en.exitCode);
  const jsonEn = await runReport({ ...io, argv: [...argv, "--json"], language: "en" });
  const jsonKo = await runReport({ ...io, argv: [...argv, "--json"], get language(): "ko" { throw new Error("JSON must not read report language"); } });
  assert.deepEqual(jsonKo, jsonEn);

  const home = path.join(base, "private-home"), config = path.join(home, process.platform === "win32" ? "Codaryn" : "codaryn", "config.json");
  await mkdir(path.dirname(config), { recursive: true }); await writeFile(config, JSON.stringify({ schemaVersion: 1, language: "ko" }));
  const cli = fileURLToPath(new URL("../../../src/cli/main.js", import.meta.url));
  async function processReport(language: "en" | "ko" | undefined, locale: "en-US" | "ko-KR", json = false) {
    // Mock only ICU's OS locale in the real CLI child; no host locale/env values are inspected.
    const preload = path.join(base, `locale-${locale}.mjs`);
    await writeFile(preload, `Intl.DateTimeFormat = class { resolvedOptions() { return { locale: ${JSON.stringify(locale)} }; } };\n`);
    const env: Record<string, string> = { SystemRoot: "C:/Windows", WINDIR: "C:/Windows", PATH: path.dirname(process.execPath), HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, TEMP: base, TMP: base };
    if (language !== undefined) env.CODARYN_LANG = language;
    const child = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, cli, ...argv, ...(json ? ["--json"] : [])], { cwd: base, env, encoding: "utf8", windowsHide: true, shell: false, timeout: 10_000 });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.stderr, "");
    return { text: child.stdout, exitCode: child.status };
  }
  assert.deepEqual(await processReport("en", "ko-KR"), en);
  assert.deepEqual(await processReport("ko", "en-US"), ko);
  assert.deepEqual(await processReport(undefined, "en-US"), en, "report does not use the synthetic config language=ko");
  assert.deepEqual(await processReport(undefined, "ko-KR"), ko);
  assert.deepEqual(await processReport("en", "en-US", true), await processReport("ko", "ko-KR", true));
  assert.deepEqual(await Promise.all(files.map(file => readFile(file))), before, "reports never alter stored records");

  await rm(files[0]!);
  try {
    const incompleteEn = await processReport("en", "en-US"), incompleteKo = await processReport("ko", "en-US");
    assert.equal(incompleteEn.exitCode, 3); assert.equal(incompleteKo.exitCode, 3);
    assert.ok(incompleteKo.text.includes("불완전 (incomplete)"));
  } finally { await writeFile(files[0]!, before[0]!); }
});
