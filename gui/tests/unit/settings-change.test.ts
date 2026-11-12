/**
 * GU-6 (3.10, 6.6): settings changes. The edit rules (src/shared/settings-edit.ts), the main
 * process's proposal tokens (src/main/settings-proposals.ts), the engine host's two calls with a
 * fake app, the main process's checks (src/shared/ipc.ts), the widening dialog's words, and the
 * settings screen with a DOM stand-in.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import { WIDENING_KINDS, widenText } from "../../src/main/dialog-texts.js";
import { PROPOSAL_TTL_MS, SettingsProposals } from "../../src/main/settings-proposals.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { settingsScreen } from "../../src/renderer/settings/settings.js";
import { parseTokenArgs, toHostProposal, toSettingsView, toWrittenReply } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { applySettingsEdit, commandText, parseSettingsEdit } from "../../src/shared/settings-edit.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const same = (text: string): string => text;
const DIGEST = "b".repeat(64);
const CONFIG = {
  schemaVersion: 1,
  model: "fake-model-a",
  limits: { maxModelTurns: 6 },
  policy: { commands: [{ executable: "npm", argsPrefix: ["test"], allowExtraArgs: false }], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths: ["a.env"] },
  secretEnv: ["MY_TOKEN"],
};

test("settings change (GU-6): an edit is checked field by field; anything else is refused", () => {
  assert.deepEqual(parseSettingsEdit({ op: "language", value: "ko" }), { op: "language", value: "ko" });
  assert.deepEqual(parseSettingsEdit({ op: "limit", key: "maxToolCalls", value: 20 }), { op: "limit", key: "maxToolCalls", value: 20 });
  assert.deepEqual(parseSettingsEdit({ op: "addCommand", executable: "npm", argsPrefix: ["run", "lint"], allowExtraArgs: false }), {
    op: "addCommand",
    executable: "npm",
    argsPrefix: ["run", "lint"],
    allowExtraArgs: false,
  });
  assert.deepEqual(parseSettingsEdit({ op: "removeSecretEnv", index: 0, shown: "MY_TOKEN" }), { op: "removeSecretEnv", index: 0, shown: "MY_TOKEN" });
  const refused: unknown[] = [
    null,
    { op: "replace", next: CONFIG },
    { op: "language", value: "fr" },
    { op: "language", value: "ko", extra: 1 },
    { op: "limit", key: "apiBaseUrl", value: 1 },
    { op: "limit", key: "maxToolCalls", value: 0 },
    { op: "limit", key: "maxToolCalls", value: 1.5 },
    { op: "addCommand", executable: "npm\nrm", argsPrefix: [], allowExtraArgs: false },
    { op: "addCommand", executable: "npm", argsPrefix: "test", allowExtraArgs: false },
    { op: "addCommand", executable: "npm", argsPrefix: [], allowExtraArgs: "yes" },
    { op: "addSecretEnv", name: "1BAD" },
    { op: "addSecretEnv", name: "A=B" },
    { op: "addProtectedPath", path: "" },
    { op: "removeCommand", index: -1, shown: "npm test" },
    { op: "removeCommand", index: 0 },
  ];
  for (const edit of refused) assert.equal(parseSettingsEdit(edit), null, JSON.stringify(edit));
});

test("settings change (GU-6): an edit makes a new config; a removal must still name the shown item", () => {
  const before = JSON.stringify(CONFIG);
  const apply = (edit: unknown) => applySettingsEdit(CONFIG, parseSettingsEdit(edit) ?? assert.fail(JSON.stringify(edit)), same);
  const language = apply({ op: "language", value: "en" });
  assert.equal(language.ok && language.next["language"], "en");
  const cleared = applySettingsEdit({ ...CONFIG, language: "ko" }, { op: "language", value: null }, same);
  assert.equal(cleared.ok && "language" in cleared.next, false);
  const unset = apply({ op: "limit", key: "maxModelTurns", value: null });
  assert.equal(unset.ok && "limits" in unset.next, false, "an empty limits object is left out");
  const added = apply({ op: "addCommand", executable: "node", argsPrefix: ["--version"], allowExtraArgs: true });
  assert.deepEqual(added.ok && (added.next["policy"] as { commands: unknown[] }).commands[1], { executable: "node", argsPrefix: ["--version"], allowExtraArgs: true });
  assert.deepEqual(apply({ op: "addCommand", executable: "npm", argsPrefix: ["test"], allowExtraArgs: false }), { ok: false, code: "already_present" });
  assert.equal(commandText(CONFIG.policy.commands[0], same), "npm test");
  assert.equal(commandText({ executable: "git", argsPrefix: ["log"], allowExtraArgs: true }, same), "git log …");
  const removed = apply({ op: "removeCommand", index: 0, shown: "npm test" });
  assert.deepEqual(removed.ok && (removed.next["policy"] as { commands: unknown[] }).commands, []);
  assert.deepEqual(apply({ op: "removeCommand", index: 0, shown: "npm run build" }), { ok: false, code: "settings_changed" });
  assert.deepEqual(apply({ op: "removeProtectedPath", index: 3, shown: "a.env" }), { ok: false, code: "settings_changed" });
  const secret = apply({ op: "removeSecretEnv", index: 0, shown: "MY_TOKEN" });
  assert.deepEqual(secret.ok && secret.next["secretEnv"], []);
  const fresh = applySettingsEdit({ schemaVersion: 1 }, { op: "addProtectedPath", path: "notes/private.md" }, same);
  assert.deepEqual(fresh.ok && fresh.next["policy"], { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths: ["notes/private.md"] });
  assert.deepEqual(applySettingsEdit(null, { op: "language", value: "ko" }, same), { ok: false, code: "settings_missing" });
  assert.equal(JSON.stringify(CONFIG), before, "the config read is not changed");
});

test("settings change (GU-6): a proposal token works once, for a while, and only the newest few are kept", () => {
  let now = 1000;
  let seed = 0;
  const proposals = new SettingsProposals((size) => Uint8Array.from({ length: size }, () => ++seed % 256), () => now);
  const proposal = { next: { schemaVersion: 1 }, baseDigest: DIGEST, changes: [], widening: [] };
  const first = proposals.issue(proposal);
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.deepEqual(proposals.take(first), proposal);
  assert.equal(proposals.take(first), null, "used once");
  const old = proposals.issue(proposal);
  now += PROPOSAL_TTL_MS + 1;
  assert.equal(proposals.take(old), null, "too old");
  const tokens = Array.from({ length: 9 }, () => proposals.issue(proposal));
  assert.equal(proposals.take(tokens[0] as string), null, "the oldest of nine is dropped");
  assert.notEqual(proposals.take(tokens[8] as string), null);
});

function host(app: Parameters<typeof fakeApp>[0]) {
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp(app),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text.replace(/[\u0000-\u001f]/g, "?"),
    envSet: (name) => name === "MY_TOKEN",
    providers: ["anthropic"],
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  return async (id: number, call: string, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call, args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error?.code;
  };
}

const READ = { ok: true, output: { kind: "settings", file: { source: "environment", path: "C:\\cfg\\config.json", display: "~/cfg/config.json", exists: true }, config: CONFIG, profiles: [], workflows: [], builtinWorkflows: [], keyAvailable: true } };

test("settings change (GU-6): the engine host applies the edit to the config read now and proposes it; apply passes the confirmation", async () => {
  const proposed: unknown[] = [];
  const applied: unknown[] = [];
  const call = host({
    readSettings: async () => READ,
    proposeSettingsChange: async (request) => {
      proposed.push(request);
      return { ok: true, output: { kind: "settings_change", baseDigest: DIGEST, digest: "c".repeat(64), changes: [{ field: "policy.commands", change: "changed" }], widening: [{ kind: "command_added", field: "policy.commands[1]" }], file: READ.output.file, config: {} } };
    },
    applySettingsChange: async (request) => {
      applied.push(request);
      return { ok: true, output: { kind: "settings_written", written: true, digest: "c".repeat(64), changes: [{ field: "policy.commands", change: "changed" }], widening: [], file: READ.output.file } };
    },
  });
  const settings = (await call(1, "settings", {})) as { view: { rules: unknown } };
  assert.deepEqual(settings.view.rules, { policySet: true, limits: [["maxModelTurns", 6]], commands: ["npm test"], protectedPaths: ["a.env"], secretEnv: [{ name: "MY_TOKEN", set: true }] });
  assert.equal(JSON.stringify(settings).includes("C:\\\\cfg"), false, "no full path");

  assert.equal(await call(2, "proposeSettings", { edit: { op: "replace", next: {} } }), "invalid_args");
  assert.equal(await call(3, "proposeSettings", { edit: { op: "language", value: "ko" }, next: {} }), "invalid_args");
  const value = await call(4, "proposeSettings", { edit: { op: "addCommand", executable: "node", argsPrefix: [], allowExtraArgs: false } });
  assert.equal(proposed.length, 1);
  const request = proposed[0] as { configPath: unknown; next: { policy: { commands: unknown[] } } };
  assert.equal(request.configPath, null);
  assert.deepEqual(request.next.policy.commands[1], { executable: "node", argsPrefix: [], allowExtraArgs: false });
  const proposal = toHostProposal(value);
  assert.equal(proposal.ok, true);
  if (!proposal.ok) return;
  assert.equal(proposal.baseDigest, DIGEST);
  assert.deepEqual(proposal.widening, [{ kind: "command_added", field: "policy.commands[1]" }]);
  assert.deepEqual(await call(5, "proposeSettings", { edit: { op: "removeCommand", index: 0, shown: "npm run x" } }), { ok: false, code: "settings_changed" });
  assert.equal(proposed.length, 1, "a stale removal is not proposed");

  assert.equal(await call(6, "applySettings", { next: proposal.next, baseDigest: "short", confirmWidening: true }), "invalid_args");
  assert.equal(await call(7, "applySettings", { next: proposal.next, baseDigest: DIGEST }), "invalid_args");
  const written = toWrittenReply(await call(8, "applySettings", { next: proposal.next, baseDigest: DIGEST, confirmWidening: true }));
  assert.deepEqual(applied, [{ configPath: null, next: proposal.next, baseDigest: DIGEST, confirmWidening: true }]);
  assert.deepEqual(written, { ok: true, written: true, changes: [{ field: "policy.commands", change: "changed" }], widening: [] });
});

test("settings change (GU-6): app failures go on as codes; the main process refuses bad shapes", async () => {
  const call = host({
    readSettings: async () => READ,
    proposeSettingsChange: async () => ({ ok: false, error: { code: "invalid_config", message: "C:\\cfg\\config.json is bad" } }),
  });
  assert.deepEqual(await call(1, "proposeSettings", { edit: { op: "language", value: "en" } }), { ok: false, code: "invalid_config" });
  const unreadable = host({ readSettings: async () => ({ ok: false, error: { code: "invalid_config", message: "x" } }) });
  assert.deepEqual(await unreadable(1, "proposeSettings", { edit: { op: "language", value: "en" } }), { ok: false, code: "settings_unreadable" });

  const good = { ok: true, next: { schemaVersion: 1 }, baseDigest: DIGEST, changes: [], widening: [] };
  assert.equal(toHostProposal(good).ok, true);
  assert.equal(toHostProposal({ ...good, baseDigest: "x" }).ok, false);
  assert.equal(toHostProposal({ ...good, next: [] }).ok, false);
  assert.equal(toHostProposal({ ...good, widening: [{ kind: "Command Added", field: "x" }] }).ok, false);
  assert.equal(toWrittenReply({ ok: true, written: "yes", changes: [], widening: [] }).ok, false);
  assert.deepEqual(parseTokenArgs({ token: "a".repeat(32) }), { token: "a".repeat(32) });
  assert.equal(parseTokenArgs({ token: "a".repeat(32), next: {} }), null);
  assert.equal(parseTokenArgs({ token: "../x" }), null);
});

test("settings change (GU-6): the settings view's rules are checked; the widening dialog names every kind", () => {
  const view = { file: null, model: null, language: null, profiles: [], workflows: { builtin: [], config: [] }, keyAvailable: false, providers: [], env: { model: false, language: false } };
  const rules = { limits: [["maxModelTurns", 6]], commands: ["npm test"], protectedPaths: [], secretEnv: [{ name: "MY_TOKEN", set: true }] };
  const ok = toSettingsView({ ok: true, view: { ...view, rules } }, { model: false, language: false });
  assert.equal(ok.ok && ok.view.rules.secretEnv[0]?.set, true);
  assert.equal(toSettingsView({ ok: true, view: { ...view, rules: { ...rules, secretEnv: [{ name: "MY_TOKEN", value: "x" }] } } }, { model: false, language: false }).ok, false);
  for (const kind of WIDENING_KINDS) {
    for (const language of ["ko", "en"] as const) assert.doesNotMatch(widenText(language, kind, "policy.commands[0]"), /undefined/);
  }
  assert.equal(widenText("en", "not_a_kind", "x\u0007"), "- another widening (x?)");
  for (const language of ["ko", "en"] as const) {
    const t = textsFor(language);
    for (const kind of WIDENING_KINDS) assert.ok(t.has(`widen.${kind}`), `${language} widen.${kind}`);
  }
});

test("settings change (GU-6): the screen proposes one edit, shows what widens, and writes by token only", async () => {
  const restore = installFakeDom();
  try {
    const calls: [string, unknown][] = [];
    let widens = false;
    const settingsView = {
      file: { display: "~/cfg/config.json", source: "environment", exists: true },
      model: "fake-model-a",
      language: null,
      profiles: [],
      workflows: { builtin: [], config: [] },
      keyAvailable: true,
      providers: [],
      env: { model: false, language: false },
      rules: { policySet: false, limits: [["maxModelTurns", 6]], commands: ["npm test"], protectedPaths: ["a.env"], secretEnv: [{ name: "MY_TOKEN", set: false }] },
    };
    const replies: Record<string, (arg: unknown) => unknown> = {
      settings: () => ({ ok: true, view: settingsView }),
      proposeSettings: (edit) => {
        calls.push(["propose", edit]);
        return { ok: true, token: "e".repeat(32), changes: [{ field: "policy.protectedPaths", change: "changed" }], widening: widens ? [{ kind: "secret_env_removed", field: "secretEnv[0]" }] : [] };
      },
      applySettings: (token) => {
        calls.push(["apply", token]);
        return { ok: true, written: true, changes: [], widening: [] };
      },
    };
    const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async (arg: unknown) => replies[name]?.(arg) ?? null });
    const announced: string[] = [];
    const screen = settingsScreen({ texts: textsFor("en"), api, language: "en", announce: (text) => announced.push(text) });
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    const byId = (id: string) => root.findAll((e) => e.getAttribute("id") === id)[0];
    assert.equal(byId("settings")?.getAttribute("data-settings-ready"), "ok");
    assert.ok(byId("settings-secrets")?.textContent.includes("not set now"));
    assert.ok(byId("settings-policy-first")?.textContent.includes("replace every task kind's rules"), "says a first policy replaces the task kinds' own");
    assert.equal(root.findAll((e) => e.getAttribute("type") === "password").length, 0, "no value field");

    // A limit that is not a whole number is refused here; nothing is asked.
    const input = byId("settings-limit-maxToolCalls") as FakeElement;
    input.value = "2.5";
    root.findAll((e) => e.getAttribute("data-limit-set") === "maxToolCalls")[0]?.click();
    assert.equal(byId("settings-proposal")?.getAttribute("data-proposal"), "bad_number");
    assert.equal(calls.length, 0);

    // Adding a protected path: a proposal without widening, then written by its token.
    (byId("settings-protected-path") as FakeElement).value = " notes/private.md ";
    byId("settings-protected-add")?.click();
    await settle();
    assert.deepEqual(calls, [["propose", { op: "addProtectedPath", path: "notes/private.md" }]]);
    assert.equal(byId("settings-proposal")?.getAttribute("data-proposal"), "ready");
    byId("settings-write")?.click();
    await settle();
    await settle();
    assert.deepEqual(calls[1], ["apply", "e".repeat(32)]);
    assert.equal(byId("settings-proposal")?.getAttribute("data-proposal"), "written");
    assert.deepEqual(announced, ["The config file was written."]);

    // Removing a secret name: the proposal says it widens and that the app asks again.
    widens = true;
    root.findAll((e) => e.getAttribute("data-remove") === "removeSecretEnv")[0]?.click();
    await settle();
    assert.deepEqual(calls[2], ["propose", { op: "removeSecretEnv", index: 0, shown: "MY_TOKEN" }]);
    assert.equal(byId("settings-proposal")?.getAttribute("data-proposal"), "widens");
    assert.ok(byId("settings-proposal")?.textContent.includes("a secret name removed (secretEnv[0])"));
    byId("settings-keep")?.click();
    assert.equal(byId("settings-proposal")?.getAttribute("data-proposal"), "kept");
    assert.equal(calls.length, 3, "keeping it asks nothing");
  } finally {
    restore();
  }
});
