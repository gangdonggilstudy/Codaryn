import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { isolatedEnv } from "./gsec-host-support.js";

const DIR = path.resolve("synthetic-e2-fixture");
const SETTINGS = ["APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "HOME", "USERPROFILE", "TEMP", "TMP"];
const OS = process.platform === "win32" ? ["SystemRoot", "WINDIR"] : [];

function observe(synthetic: NodeJS.ProcessEnv) {
  // Save the reference only: never inspect or copy the developer's original variable values.
  const original = process.env;
  const reads: string[] = [];
  let enumerations = 0;
  let result: Record<string, string>;
  try {
    process.env = new Proxy(synthetic, {
      get(target, key, receiver) { reads.push(String(key)); return Reflect.get(target, key, receiver); },
      ownKeys(target) { enumerations += 1; return Reflect.ownKeys(target); },
    });
    result = isolatedEnv(DIR);
  } finally {
    process.env = original;
  }
  assert.equal(process.env, original, "the exact original env reference is restored");
  assert.equal(enumerations, 0, "the input environment is never enumerated");
  assert.deepEqual(reads, OS, "only the required OS values are read, by name");
  return result;
}

test("E-2: arbitrary host values, synthetic credentials and runtime/config switches never cross", () => {
  const systemRoot = path.join(path.parse(DIR).root, "synthetic-windows");
  const windir = path.join(path.parse(DIR).root, "other-synthetic-windows");
  const synthetic = {
    "SystemRoot": systemRoot, "WINDIR": windir,
    "PATH": "fixture inherited path", "COMSPEC": "fixture shell", "PATHEXT": ".FIXTURE",
    "E2_UNREGISTERED": "fixture arbitrary variable", "HTTP_PROXY": "fixture proxy", "LANG": "fixture locale",
    "ANTHROPIC_API_KEY": "fixture anthropic value", "OPENAI_API_KEY": "fixture openai value",
    "CODARYN_CONFIG": "fixture config", "CODARYN_OTHER": "fixture other", "NODE_OPTIONS": "fixture node flags",
    "NODE_PATH": "fixture node path", "ELECTRON_RUN_AS_NODE": "fixture electron flag",
  };
  const result = observe(synthetic);
  assert.deepEqual(Object.keys(result).sort(), ["PATH", ...SETTINGS, ...OS].sort(), "exact output allowlist");
  for (const name of ["E2_UNREGISTERED", "HTTP_PROXY", "LANG", "COMSPEC", "PATHEXT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODARYN_CONFIG", "CODARYN_OTHER", "NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE"]) {
    assert.equal(Object.hasOwn(result, name), false, `${name} is absent`);
  }
  for (const name of SETTINGS) {
    assert.equal(result[name], DIR, `${name} uses the case's own directory`);
    const relative = path.relative(DIR, result[name]!);
    assert.ok(relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)));
  }
  for (const name of OS) assert.equal(result[name], synthetic[name as keyof typeof synthetic]);
  const expected = path.dirname(process.execPath) + (process.platform === "win32" ? path.delimiter + path.join(systemRoot, "System32") : "");
  assert.equal(result.PATH, expected, "PATH is constructed independently of the input PATH");
});

test("E-2: absent OS values add no inherited names; WINDIR alone supplies the Windows system path", () => {
  const windir = path.join(path.parse(DIR).root, "synthetic-windows-only");
  for (const synthetic of [{}, { WINDIR: windir }]) {
    const result = observe(synthetic);
    const expected = { PATH: path.dirname(process.execPath), ...Object.fromEntries(SETTINGS.map((name) => [name, DIR])) };
    if (process.platform === "win32" && "WINDIR" in synthetic) {
      Object.assign(expected, { WINDIR: windir, PATH: expected.PATH + path.delimiter + path.join(windir, "System32") });
    }
    assert.deepEqual(result, expected);
  }
});
