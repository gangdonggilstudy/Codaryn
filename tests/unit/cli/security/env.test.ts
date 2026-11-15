import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { secretEnvNotSetMessage, selectEnvFileSecrets, validateSecretEnvNames } from "../../../../src/cli/security/index.js";
import { ANTHROPIC_API_KEY_ENV } from "../../../../src/contracts/index.js";

describe("S-3 validateSecretEnvNames", () => {
  test("accepts variable names", () => {
    assert.deepEqual(validateSecretEnvNames(["DB_PASSWORD", "_X1", "a"], "privacy.secretEnv"), {
      ok: true,
      names: ["DB_PASSWORD", "_X1", "a"],
    });
    assert.deepEqual(validateSecretEnvNames([], "secretEnv"), { ok: true, names: [] });
  });

  test("H2-3: a value written in place of a name is rejected without echoing it", () => {
    const value = "fake-db-password-VALUE-777";
    const outcome = validateSecretEnvNames(["OK_NAME", value], "privacy.secretEnv");
    assert.deepEqual(outcome, { ok: false, message: "privacy.secretEnv[1] is not a valid environment variable name" });
    assert.ok(!JSON.stringify(outcome).includes("fake-db"));
  });

  test("rejects everything that is not a plain name", () => {
    for (const bad of ["", "1ABC", "A B", "A-B", "ÄBC", "A=B", "A\0B", "$HOME"]) {
      const outcome = validateSecretEnvNames([bad], "secretEnv");
      assert.equal(outcome.ok, false, JSON.stringify(bad));
      if (!outcome.ok && bad.length > 0) assert.ok(!outcome.message.includes(bad), bad);
    }
    assert.deepEqual(validateSecretEnvNames("DB_PASSWORD", "secretEnv"), { ok: false, message: "secretEnv must be an array of environment variable names" });
    assert.deepEqual(validateSecretEnvNames([7], "secretEnv"), { ok: false, message: "secretEnv[0] is not a valid environment variable name" });
  });

  test("the not-set message names the position, never the variable", () => {
    const message = secretEnvNotSetMessage("privacy.secretEnv", 2);
    assert.equal(message, "privacy.secretEnv[2] names an environment variable that is not set");
  });
});

describe("S-4 selectEnvFileSecrets", () => {
  const before = { PATH: "C:\\Windows", EXISTING_TOKEN: "already-set-in-shell-0000" };

  test("registers values of variables the env file added", () => {
    const after = {
      ...before,
      OTHER_SERVICE_PASSWORD: "fake-other-service-password-1",
      [ANTHROPIC_API_KEY_ENV]: "fake-anthropic-key-from-env-file-0000",
      DB_URL: "postgres://user:fake-pass@localhost/db",
    };
    assert.deepEqual(selectEnvFileSecrets(before, after, "linux").sort(), [
      "fake-anthropic-key-from-env-file-0000",
      "fake-other-service-password-1",
      "postgres://user:fake-pass@localhost/db",
    ]);
  });

  test("skips variables that were already set, the CODARYN settings and short values", () => {
    const after = {
      ...before,
      EXISTING_TOKEN: "changed-but-not-by-the-file",
      CODARYN_MODEL: "claude-opus-5-5",
      CODARYN_CONFIG: "C:\\cfg\\codaryn.json",
      CODARYN_API_BASE_URL: "https://api.anthropic.com",
      SHORT: "1234567",
      EMPTY: "",
      LONG_ENOUGH: "12345678",
    };
    assert.deepEqual(selectEnvFileSecrets(before, after, "linux"), ["12345678"]);
  });

  test("Windows compares variable names without case", () => {
    const after = { Path: "C:\\Windows", existing_token: "x".repeat(20), codaryn_model: "claude-opus-5-5-variant", NEW_ONE: "fake-new-value-0001" };
    assert.deepEqual(selectEnvFileSecrets(before, after, "win32"), ["fake-new-value-0001"]);
    // POSIX names are case-sensitive: a different case is a different variable.
    assert.deepEqual(selectEnvFileSecrets({ token: "y".repeat(10) }, { token: "y".repeat(10), TOKEN: "fake-upper-0001" }, "linux"), [
      "fake-upper-0001",
    ]);
  });

  test("also registers the trimmed value and never repeats a value", () => {
    const after = { A: "  fake-padded-value-01  ", B: "  fake-padded-value-01  ", C: "fake-padded-value-01" };
    assert.deepEqual(selectEnvFileSecrets({}, after, "linux"), ["  fake-padded-value-01  ", "fake-padded-value-01"]);
  });
});
