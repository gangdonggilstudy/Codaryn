/**
 * GU-1: the narrow channel's checks (src/shared/ipc.ts), the preload's copy of the channel names,
 * and the renderer's rule of no HTML from values.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { IPC_CHANNELS, IPC_EVENTS, doctorMessageIds, isNoArgs, parseDoctorArgs, toDoctorView } from "../../src/shared/ipc.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const HANDLE = "0123456789abcdef0123456789abcdef";

test("ipc: doctor takes a handle or null and nothing else", () => {
  assert.deepEqual(parseDoctorArgs({ workspace: HANDLE }), { workspace: HANDLE });
  assert.deepEqual(parseDoctorArgs({ workspace: null }), { workspace: null });
  assert.deepEqual(parseDoctorArgs({}), { workspace: null });
  for (const args of [
    { workspace: "D:\\work\\notes" },
    { workspace: HANDLE.toUpperCase() },
    { workspace: `${HANDLE}0` },
    { workspace: HANDLE, path: "x" },
    null,
    "text",
    [HANDLE],
  ]) {
    assert.equal(parseDoctorArgs(args), null, JSON.stringify(args));
  }
  assert.equal(isNoArgs([]), true);
  assert.equal(isNoArgs([undefined]), true);
  assert.equal(isNoArgs([null]), false);
});

test("ipc: the doctor view keeps the checked fields only and refuses other shapes", () => {
  const output = {
    schemaVersion: 1,
    kind: "doctor",
    status: "warn",
    exitCode: 3,
    checks: [
      { id: "node_version", status: "ok", message: "Node 26.13.1", extra: "dropped" },
      { id: "api_key", status: "skipped", message: "x".repeat(2000) },
    ],
  };
  const view = toDoctorView(output);
  assert.deepEqual(view?.checks[0], { id: "node_version", status: "ok", message: "Node 26.13.1" });
  assert.equal(view?.checks[1]?.message.length, 1000);
  assert.deepEqual(doctorMessageIds(view as NonNullable<typeof view>), [
    "doctor.check.node_version",
    "doctor.status.ok",
    "doctor.check.api_key",
    "doctor.status.skipped",
  ]);
  for (const bad of [
    { ...output, kind: "run" },
    { ...output, status: "great" },
    { ...output, checks: [{ id: "Bad-Id", status: "ok", message: "" }] },
    { ...output, checks: [{ id: "x", status: "maybe", message: "" }] },
    { ...output, checks: [{ id: "x", status: "ok", message: 1 }] },
    { ...output, checks: "none" },
    null,
  ]) {
    assert.equal(toDoctorView(bad), null, JSON.stringify(bad));
  }
});

test("ipc: the preload repeats exactly the shared channel names", () => {
  const source = readFileSync(path.join(GUI, "src", "preload", "preload.cts"), "utf8");
  const named = [...source.matchAll(/"(codaryn:[a-z]+:[a-z]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(named, [...Object.values(IPC_CHANNELS), ...Object.values(IPC_EVENTS)].sort());
  assert.doesNotMatch(source, /exposeInMainWorld\([^)]*ipcRenderer\s*\)/, "ipcRenderer itself is not exposed");
});

test("ipc: renderer sources put no value in as HTML", () => {
  const dir = path.join(GUI, "src", "renderer");
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter((name) => name.endsWith(".ts"));
  assert.ok(files.length >= 5);
  for (const name of files) {
    const text = readFileSync(path.join(dir, name), "utf8");
    assert.doesNotMatch(text, /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(/, name);
  }
});
