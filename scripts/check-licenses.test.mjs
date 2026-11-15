import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classifyLicense, collectPackages, NOTICE, run } from "./check-licenses.mjs";

test("DR-75: six exact permitted identifiers retain their distinction from review/deny", () => {
  for (const license of ["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"]) {
    assert.equal(classifyLicense(license), "allow", license);
  }
  for (const license of ["LGPL-2.1-only", "LGPL-3.0-or-later", "MPL-2.0", "BSL-1.0", "BSD", "Unknown-License", "SEE LICENSE IN LICENSE", { type: "MIT" }]) {
    assert.equal(classifyLicense(license), "review", JSON.stringify(license));
  }
  for (const license of ["GPL-2.0-only", "AGPL-3.0-or-later", "SSPL-1.0", "BUSL-1.1", "NonCommercial", "LicenseRef-Non-Commercial", "CC-BY-NC-SA-4.0", "Paid-Only", "Commercial-Only", undefined, null, "", "UNLICENSED"]) {
    assert.equal(classifyLicense(license), "deny", String(license));
  }
});

test("DR-75: OR alternatives require review unless all deny; AND/WITH retain required denials", () => {
  for (const license of [
    "MIT OR Apache-2.0", "MIT OR GPL-3.0-only", "(MIT OR Apache-2.0)",
    "MIT AND ISC", "Apache-2.0 WITH LLVM-exception", "LGPL-2.1-only OR MIT", "(MIT)",
    "GPL-2.0-only OR MPL-2.0", "(MIT OR GPL-3.0-only) AND ISC", "GPL-2.0-only OR (MIT AND ISC)",
    "(MIT OR GPL-3.0-only", "MIT OR", "GPL-2.0-only OR ()",
  ]) {
    assert.equal(classifyLicense(license), "review", license);
  }
  for (const license of [
    "GPL-2.0-only OR AGPL-3.0-only", "GPL-2.0-only WITH Classpath-exception-2.0", "BUSL-1.1 AND MIT",
    "(GPL-2.0-only OR AGPL-3.0-only)", "(GPL-2.0-only AND MIT) OR AGPL-3.0-only",
  ]) {
    assert.equal(classifyLicense(license), "deny", license);
  }
});

const synthetic = { packages: {
  "": { name: "root-should-be-excluded", version: "1", license: "UNLICENSED" },
  "node_modules/@scope/tool": { version: "2", license: "MIT", dev: true, optional: true },
  "node_modules/parent/node_modules/child": { name: "declared-name", version: "3", license: "LGPL-2.1-only" },
  "node_modules/no-license": { version: "4", optional: true },
} };

test("DR-75: synthetic lock keeps root out, scoped/nested names and independent flags", () => {
  assert.deepEqual(collectPackages(synthetic, "test-lock"), [
    { lock: "test-lock", path: "node_modules/@scope/tool", name: "@scope/tool", version: "2", license: "MIT", dev: true, optional: true, classification: "allow" },
    { lock: "test-lock", path: "node_modules/no-license", name: "no-license", version: "4", license: null, dev: false, optional: true, classification: "deny" },
    { lock: "test-lock", path: "node_modules/parent/node_modules/child", name: "declared-name", version: "3", license: "LGPL-2.1-only", dev: false, optional: false, classification: "review" },
  ]);
});

test("DR-75: review/deny remain nonblocking and JSON/table carry the same inventory", () => {
  const read = () => JSON.stringify(synthetic);
  let text = "", json = "";
  assert.equal(run({ read, out: (s) => { text += s; } }), 0);
  assert.equal(run({ read, jsonOutput: true, out: (s) => { json += s; } }), 0);
  const data = JSON.parse(json);
  assert.deepEqual(data.summary, { allow: 2, review: 2, deny: 2 });
  assert.equal(data.packages.length, 6);
  assert.equal(data.notice, NOTICE);
  for (const row of data.packages) assert.ok(text.includes([row.lock, row.name, row.version, row.license ?? "(미기재)", row.dev, row.optional, row.classification].join("\t")));
  assert.ok(text.endsWith(NOTICE + "\n"));
});

test("DR-75: only unreadable or broken JSON input returns exit2; valid unknown schema warns", () => {
  for (const read of [() => { throw new Error("synthetic read failure"); }, () => "{broken"]) {
    let error = "";
    assert.equal(run({ read, out: () => assert.fail("no partial inventory"), err: (s) => { error += s; } }), 2);
    assert.match(error, /package-lock\.json: (?:read_error|invalid_json)/);
    assert.ok(!error.includes("synthetic read failure"));
  }
  let output = "";
  assert.equal(run({ read: () => "null", jsonOutput: true, out: (s) => { output += s; } }), 0);
  assert.equal(JSON.parse(output).warnings.length, 2);
});

test("DR-75: both actual locks are allow; standalone CLI works outside repository root cwd", () => {
  for (const lockFile of ["../package-lock.json", "../gui/package-lock.json"]) {
    const rows = collectPackages(JSON.parse(readFileSync(new URL(lockFile, import.meta.url), "utf8")), lockFile);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.classification === "allow"));
  }
  const script = fileURLToPath(new URL("./check-licenses.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--json"], {
    cwd: fileURLToPath(new URL("./", import.meta.url)), env: {}, encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  const inventory = JSON.parse(result.stdout);
  assert.ok(inventory.summary.allow > 0);
  assert.deepEqual([inventory.summary.review, inventory.summary.deny], [0, 0]);
  assert.equal(new Set(inventory.packages.map((row) => row.lock)).size, 2);
});
