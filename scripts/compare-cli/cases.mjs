// U-130: the cases scripts/compare-cli-boards.mjs runs with each build's real CLI.
//
// Every case runs in a fresh folder: `setup(dir, { api })` writes its files, then its steps run one
// after another with that folder as the working directory. A step is { args, lang?, env?, terminal?,
// answers? } or a function of the steps before it (ctx) that returns one, for run ids and digests the
// CLI chose. `terminal` names the streams that look like a terminal (an imitation, see the tool);
// `answers` are typed one by one at the questions.
// Models are scripted, except in the cases with `api` (a permission question needs a config's rule,
// and a config's runs use an API provider): those get a fake Anthropic API on 127.0.0.1 and
// FAKE_API_KEY. An address in any other config is a closed loopback port.
// Fake values only; a key-shaped text is built at run time, never written in this file.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** A closed loopback port: an address that is never reached. */
export const CLOSED_LOOPBACK = "http://127.0.0.1:9";
const FAKE_SECRET = "fake-compare-SECRET-0042";
/** The key the cases with a fake API use; it never leaves the loopback fake server. */
export const FAKE_API_KEY = "cdy-fake-apikey-compareCLI01";
const CTRL_C = String.fromCharCode(3);
/** The streams a terminal shows output on, and those of a terminal that is also asked. */
const SHOWN = "stdout,stderr";
const ASKED = "stdin,stdout,stderr";
const NO_RUN = "20200101T000000Z-00000000";

function write(dir, relative, content) {
  const file = path.join(dir, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`, "utf8");
}

/** A scripted document task in `./work` with its script in `./script.json`. */
function task(extra = {}) {
  return {
    schemaVersion: 1,
    id: "compare-task",
    goal: "Write a summary of notes.md into summary.md.",
    workflow: "document",
    workspaceRoot: "./work",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 8, maxToolCalls: 10, maxTotalTokens: null, maxDurationMs: 60000, maxRepairAttempts: 1, maxSameFailures: 2 },
    verifiers: [{ id: "summary", kind: "file_rules", rules: [{ type: "contains", path: "summary.md", text: "## Decisions" }] }],
    ...extra,
  };
}

const writeFile = (path, content, expectedHash = null) => ({ name: "write_file", args: { path, expectedHash, change: { kind: "replace_all", content } } });
const SUMMARY = "# Summary\n\n## Decisions\n\n- The site moves next week.\n";
/** The repair case's first summary, and its hash for the second write (write_file's expectedHash). */
const FIRST_SUMMARY = "# Summary\n\n## Decisions\n";
const FIRST_SUMMARY_HASH = createHash("sha256").update(FIRST_SUMMARY, "utf8").digest("hex");

/** A workspace with notes.md, a task and a script. */
function documentSetup(steps, taskExtra = {}, files = {}) {
  return (dir) => {
    write(dir, "work/notes.md", "# Weekly notes\n\n- The site moves next week.\n");
    for (const [name, content] of Object.entries(files)) write(dir, name, content);
    write(dir, "task.json", task(taskExtra));
    write(dir, "script.json", { schemaVersion: 1, steps });
  };
}

const DOCUMENT_STEPS = [{ toolCalls: [{ name: "read_file", args: { path: "notes.md" } }] }, { toolCalls: [writeFile("summary.md", SUMMARY)] }, { text: "The summary is written." }];

const run = (...more) => ({ args: ["run", "--task", "task.json", ...more] });
const report = (run, ...more) => ({ args: ["report", "--workspace", "work", "--run", run, ...more] });
const runs = (...more) => ({ args: ["runs", "--workspace", "work", ...more] });
const runIdOf = (step) => (ctx) => ctx.json(step)?.runId ?? "none";

/** An organize task whose scripted model proposes a move and a discard. */
function planSetup(dir) {
  write(dir, "work/inbox/a.txt", "alpha\n");
  write(dir, "work/inbox/old.tmp", "old\n");
  write(dir, "task.json", task({ workflowRef: "organize", goal: "Sort the inbox.", policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move", "discard"] }, verifiers: [] }));
  write(dir, "script.json", {
    schemaVersion: 1,
    steps: [
      {
        toolCalls: [
          {
            name: "propose_plan",
            args: { summary: "Sort the inbox", actions: [{ kind: "move", from: "inbox/a.txt", to: "sorted/a.txt" }, { kind: "discard", path: "inbox/old.tmp" }] },
          },
        ],
      },
    ],
  });
}

/** The command the permission cases' model asks to run, twice; a config's rule allows it after a yes. */
const NODE = process.execPath;
const check = (word) => ({ type: "tool_use", id: `toolu_${word}`, name: "run_command", input: { executable: NODE, args: ["-e", `process.stdout.write("${word}")`] } });
function permissionReplies() {
  return [[check("one")], [check("two")], [{ type: "text", text: "Both checks are asked." }]];
}
/** A quick run's config with the fake API's address and one asking command rule (U-109). */
function permissionSetup(dir, { api }) {
  write(dir, "work/notes.md", "# Weekly notes\n");
  write(dir, "config.json", {
    schemaVersion: 1,
    model: "fake-model",
    maxOutputTokens: 256,
    apiBaseUrl: api,
    requestTimeoutMs: 20000,
    maxRetries: 0,
    limits: { maxModelTurns: 6, maxToolCalls: 6, maxTotalTokens: 200000, maxDurationMs: 60000 },
    policy: { commands: [{ executable: NODE, argsPrefix: ["-e"], allowExtraArgs: true, confirm: true }], network: "deny", destructive: "deny", restorePathTokens: false },
  });
}
const PERMISSION_RUN = ["run", "--config", "config.json", "--workspace", "work", "--goal", "Run the two checks."];

export const CASES = [
  {
    name: "document-run",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [
      run(),
      report("latest"),
      report("latest", "--json"),
      runs(),
      runs("--json"),
      (ctx) => ({ args: ["changes", "--task", "task.json", "--run", runIdOf(0)(ctx), "--json"] }),
      (ctx) => ({ args: ["changes", "--task", "task.json", "--run", runIdOf(0)(ctx)] }),
    ],
  },
  { name: "document-run-ko", lang: "ko", setup: documentSetup(DOCUMENT_STEPS), steps: [run(), report("latest"), runs()] },
  { name: "document-run-quiet", setup: documentSetup(DOCUMENT_STEPS), steps: [run("--quiet"), report("latest", "--json")] },
  {
    name: "denials",
    setup: documentSetup(
      [
        { toolCalls: [writeFile("notes.md", "replaced\n")] },
        { toolCalls: [{ name: "run_command", args: { executable: "node", args: ["--version"] } }] },
        { toolCalls: [{ name: "read_file", args: { path: "../outside.txt" } }] },
        { toolCalls: [writeFile("summary.md", SUMMARY)] },
        { text: "Done, with refusals." },
      ],
      { policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths: ["notes.md"] } },
      { "outside.txt": "outside the workspace\n" },
    ),
    steps: [run(), report("latest")],
  },
  {
    name: "repair",
    setup: documentSetup(
      [
        { toolCalls: [writeFile("summary.md", FIRST_SUMMARY)] },
        { text: "Done." },
        { toolCalls: [writeFile("summary.md", "# Summary\n\n## Decisions\n\n## Actions\n\n- Draft the guide.\n", FIRST_SUMMARY_HASH)] },
        { text: "Fixed." },
      ],
      {
        verifiers: [
          {
            id: "summary",
            kind: "file_rules",
            rules: [
              { type: "contains", path: "summary.md", text: "## Decisions" },
              { type: "contains", path: "summary.md", text: "## Actions" },
            ],
          },
        ],
      },
    ),
    steps: [run(), report("latest")],
  },
  {
    name: "secret-masked",
    env: { CMP_SECRET: FAKE_SECRET },
    setup: documentSetup(
      [{ toolCalls: [{ name: "read_file", args: { path: "config.txt" } }] }, { toolCalls: [writeFile("summary.md", SUMMARY)] }, { text: "Done." }],
      { privacy: { secretEnv: ["CMP_SECRET"] } },
      { "work/config.txt": `password=${FAKE_SECRET}\n` },
    ),
    steps: [run(), report("latest", "--json"), (ctx) => ({ args: ["changes", "--task", "task.json", "--run", runIdOf(0)(ctx), "--json"] })],
  },
  {
    name: "plan-apply",
    setup: planSetup,
    steps: [
      run(),
      (ctx) => ({ args: ["plan", "--task", "task.json", "--run", runIdOf(0)(ctx)] }),
      (ctx) => ({ args: ["plan", "--task", "task.json", "--run", runIdOf(0)(ctx), "--json"] }),
      (ctx) => ({ args: ["apply", "--task", "task.json", "--run", runIdOf(0)(ctx), "--digest", String(ctx.json(0)?.plan?.digest ?? "none").slice(0, 12)] }),
      report("latest"),
      (ctx) => ({ args: ["revert", "--workspace", "work", "--run", runIdOf(3)(ctx), "--dry-run"] }),
      (ctx) => ({ args: ["revert", "--workspace", "work", "--run", runIdOf(3)(ctx)] }),
    ],
  },
  {
    name: "revert",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [
      run(),
      (ctx) => ({ args: ["revert", "--workspace", "work", "--run", runIdOf(0)(ctx), "--dry-run"] }),
      (ctx) => ({ args: ["revert", "--workspace", "work", "--run", runIdOf(0)(ctx)] }),
      (ctx) => ({ args: ["revert", "--workspace", "work", "--run", runIdOf(0)(ctx)] }),
      runs(),
    ],
  },
  {
    name: "cleanup-preview",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [run(), (ctx) => ({ args: ["cleanup", "--workspace", "work", "--run", runIdOf(0)(ctx)] }), (ctx) => ({ args: ["cleanup", "--workspace", "work", "--run", runIdOf(0)(ctx), "--json"] })],
  },
  {
    name: "read-commands",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [{ args: ["doctor"] }, { args: ["doctor", "--json"] }, { args: ["models"] }, { args: ["models", "--json"] }, { args: ["--help"] }, { args: ["--version"] }, { args: [] }],
  },
  {
    name: "errors",
    setup: documentSetup(DOCUMENT_STEPS, {}, {
      "bad-config.json": '{ "schemaVersion": 1, "model": ',
      "nowhere-task.json": task({ workspaceRoot: "./nowhere" }),
      "secret-task.json": task({ privacy: { secretEnv: ["CMP_MISSING"] } }),
      // A quick run whose config names a closed loopback address; it stops at the missing key first.
      "address-config.json": {
        schemaVersion: 1,
        model: "fake-model",
        maxOutputTokens: 64,
        apiBaseUrl: CLOSED_LOOPBACK,
        limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 1000, maxDurationMs: 60000 },
      },
    }),
    steps: [
      { args: ["frobnicate"] },
      { args: ["run"] },
      { args: ["run", "--task", "missing.json"] },
      { args: ["run", "--task", "task.json", "--config", "bad-config.json"] },
      () => ({ args: ["run", "--workspace", "work", "--goal", `use ${["sk", "ant", "api03", "FAKE".repeat(20)].join("-")}`] }),
      { args: ["run", "--task", "nowhere-task.json"] },
      { args: ["run", "--task", "secret-task.json"] },
      { args: ["run", "--workspace", "work", "--goal", "Summarize the notes.", "--config", "address-config.json"] },
      { args: ["report", "--workspace", "work", "--run", "../x"] },
      { args: ["report", "--workspace", "work", "--run", NO_RUN] },
      { args: ["revert", "--workspace", "work", "--run", NO_RUN] },
      { args: ["plan", "--task", "task.json", "--run", NO_RUN] },
    ],
  },
  {
    name: "errors-ko",
    lang: "ko",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [{ args: ["frobnicate"] }, { args: ["run", "--task", "missing.json"] }, { args: ["report", "--workspace", "work", "--run", NO_RUN] }],
  },
  // U-135: terminal cases (imitated: see the tool).
  {
    name: "terminal-first-page",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [
      { args: [], terminal: SHOWN },
      { args: ["--help"], terminal: SHOWN },
      { args: ["--help"], terminal: SHOWN, lang: "ko" },
    ],
  },
  {
    name: "terminal-doctor",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [
      { args: ["doctor"], terminal: SHOWN },
      { args: ["doctor"], terminal: SHOWN, lang: "ko" },
    ],
  },
  {
    name: "terminal-run",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [
      { ...run(), terminal: SHOWN },
      { ...run(), terminal: SHOWN, lang: "ko" },
      { ...report("latest"), terminal: SHOWN },
    ],
  },
  {
    name: "terminal-init",
    setup: (dir) => write(dir, "work/package.json", { name: "compare", scripts: { test: "node --test", lint: "node lint.js" } }),
    steps: [
      { args: ["init", "--workspace", "work"], terminal: ASKED, answers: ["y", "", "y", "n"] },
      { args: ["init", "--workspace", "work"], terminal: ASKED, answers: ["y"] },
    ],
  },
  {
    name: "terminal-init-declined",
    setup: (dir) => mkdirSync(path.join(dir, "work"), { recursive: true }),
    steps: [{ args: ["init", "--workspace", "work"], terminal: ASKED, answers: ["n"] }],
  },
  {
    name: "terminal-apply-yes",
    setup: planSetup,
    steps: [run(), (ctx) => ({ args: ["apply", "--task", "task.json", "--run", runIdOf(0)(ctx)], terminal: ASKED, answers: ["y"] }), report("latest")],
  },
  {
    name: "terminal-apply-no",
    setup: planSetup,
    steps: [run(), (ctx) => ({ args: ["apply", "--task", "task.json", "--run", runIdOf(0)(ctx)], terminal: ASKED, answers: ["n"] }), runs()],
  },
  {
    name: "terminal-permission",
    api: { replies: permissionReplies() },
    setup: permissionSetup,
    steps: [{ args: PERMISSION_RUN, terminal: ASKED, answers: ["y", "n"] }, report("latest")],
  },
  {
    name: "terminal-permission-ctrl-c",
    api: { replies: permissionReplies() },
    setup: permissionSetup,
    steps: [{ args: PERMISSION_RUN, terminal: ASKED, answers: [CTRL_C] }, report("latest")],
  },
];
