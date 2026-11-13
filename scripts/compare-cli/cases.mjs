// U-130: the cases scripts/compare-cli-boards.mjs runs with each build's real CLI.
//
// Every case runs in a fresh folder: `setup(dir, { api })` writes its files, then its steps run one
// after another with that folder as the working directory. A step is { args, lang?, env?, terminal?,
// answers? } or a function of the steps before it (ctx) that returns one, for run ids and digests the
// CLI chose. `terminal` names the streams that look like a terminal (an imitation, see the tool);
// `answers` are typed one by one at the questions.
// Models are scripted, except in the cases with `api` (a permission question needs a config's rule,
// and a config's runs use an API provider; `codaryn models` lists the API's models, U-167): those
// get a fake Anthropic API on 127.0.0.1 and FAKE_API_KEY. An address in any other config is a
// closed loopback port.
// Fake values only; a key-shaped text is built at run time, never written in this file.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * U-167: the models the fake API lists for `codaryn models`, as API model objects: two with every
 * field, one with a Korean name and no token limits (shown as missing).
 */
const FAKE_MODELS = [
  { type: "model", id: "fake-model-a", display_name: "Fake Model A", created_at: "2026-01-02T00:00:00Z", max_input_tokens: 200000, max_tokens: 64000 },
  { type: "model", id: "fake-model-b", display_name: "Fake Model B", created_at: "2026-01-01T00:00:00Z", max_input_tokens: 100000, max_tokens: 8192 },
  { type: "model", id: "fake-model-c", display_name: "모의 모델 C", created_at: "2025-12-01T00:00:00Z" },
];
/** A config with the fake API's address and a current model that the list has (marked in the table). */
function modelsSetup(dir, { api }) {
  write(dir, "config.json", { schemaVersion: 1, model: "fake-model-b", apiBaseUrl: api });
}
const models = (...more) => ({ args: ["models", "--config", "config.json", ...more] });

/**
 * U-167 (R-94 I1): an analyze run that ends waiting for a person's review, having written two
 * files (so a reject has something to revert).
 */
function analyzeSetup(dir) {
  write(dir, "work/data/sales.csv", "region,amount\nnorth,10\nsouth,5\nnorth,2.5\n");
  write(dir, "task.json", task({ id: "compare-analyze", workflow: "analyze", workflowRef: "analyze", goal: "Total the sales by region.", verifiers: [{ id: "report", kind: "file_rules", rules: [{ type: "contains", path: "out/report.md", text: "# Sales" }] }] }));
  write(dir, "script.json", {
    schemaVersion: 1,
    steps: [
      { toolCalls: [{ name: "read_file", args: { path: "data/sales.csv" } }] },
      { toolCalls: [writeFile("out/summary.csv", "region,total\nnorth,12.5\nsouth,5\n")] },
      { toolCalls: [writeFile("out/report.md", "# Sales\n\n- north sold most (12.5).\n")] },
      { text: "The analysis is written." },
    ],
  });
}
/** U-167 (R-94 I1): the plan of planSetup, and a config for applying it in the quick form (another task id). */
function otherTaskSetup(dir) {
  planSetup(dir);
  write(dir, "quick-config.json", {
    schemaVersion: 1,
    limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 10000, maxDurationMs: 60000 },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move", "discard"] },
  });
}
const digestOf = (step) => (ctx) => String(ctx.json(step)?.plan?.digest ?? "none").slice(0, 12);
const QUICK_APPLY = ["apply", "--workspace", "work", "--workflow", "organize", "--config", "quick-config.json"];

/**
 * U-250 (the migration plan's P-2): runs that call the task-type tools (inspect_files, propose_plan,
 * query_table, propose_changes), whose names the app's run events now show (they read "(unknown
 * tool)" before). The CLI uses no events, so its output and records must stay the same.
 */
/** An organize run that looks at the inbox (inspect_files) before it proposes the plan. */
function inspectSetup(dir) {
  planSetup(dir);
  write(dir, "script.json", {
    schemaVersion: 1,
    steps: [
      { toolCalls: [{ name: "inspect_files", args: { path: "inbox", hash: true } }] },
      { toolCalls: [{ name: "propose_plan", args: { summary: "Sort the inbox", actions: [{ kind: "move", from: "inbox/a.txt", to: "sorted/a.txt" }] } }] },
    ],
  });
}
/** A config task type with query_table (a table of no personal data: every group shown). */
function querySetup(dir) {
  write(dir, "work/data/sales.csv", "region,amount\nnorth,10\nsouth,5\nnorth,2.5\n");
  write(dir, "config.json", { schemaVersion: 1, workflows: { tables: { tools: ["read_file", "query_table", "write_file"] } } });
  write(dir, "task.json", task({ id: "compare-query", workflowRef: "tables", goal: "Total the sales by region.", verifiers: [{ id: "report", kind: "file_rules", rules: [{ type: "contains", path: "out/report.md", text: "# Sales" }] }] }));
  write(dir, "script.json", {
    schemaVersion: 1,
    steps: [
      { toolCalls: [{ name: "query_table", args: { path: "data/sales.csv", groupBy: ["region"], operations: [{ op: "sum", column: "amount" }, { op: "count", column: "amount" }] } }] },
      { toolCalls: [writeFile("out/report.md", "# Sales\n\n- north 12.5, south 5.\n")] },
      { text: "The totals are written." },
    ],
  });
}
/** A config task type with plan "run": the model proposes the files to change (propose_changes). */
const RUN_PLAN_CONFIG = { schemaVersion: 1, workflows: { rewrite: { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run" } } };
function runPlanSetup(dir) {
  write(dir, "work/notes.md", "# Weekly notes\n\n- The site moves next week.\n");
  write(dir, "config.json", RUN_PLAN_CONFIG);
  write(dir, "task.json", task({ id: "compare-run-plan", workflowRef: "rewrite", goal: "Write a summary of notes.md into summary.md." }));
  write(dir, "script.json", {
    schemaVersion: 1,
    steps: [{ toolCalls: [{ name: "propose_changes", args: { summary: "Add the summary", files: [{ path: "summary.md", change: "create" }] } }] }, { text: "The plan is proposed." }],
  });
}
/**
 * The run that carries the plan out starts its script at the first step again, so the step before its
 * apply writes that run's steps (each build has its own fresh case folder; both get the same file).
 */
function carryingScript(dir) {
  write(dir, "script.json", { schemaVersion: 1, steps: [{ toolCalls: [{ name: "read_file", args: { path: "notes.md" } }] }, { toolCalls: [writeFile("summary.md", SUMMARY)] }, { text: "The summary is written." }] });
}
const RUN_PLAN = ["--task", "task.json", "--config", "config.json"];

/**
 * U-256: the paths the migration's C-2 to C-5 pass that no case covered yet (the plan's 5.2: a stage
 * adds its cases first), and the gaps nc-human's preparation report names for C-9a and C-9b.
 * Bundle A (C-3b's merging of every source's list and k, C-5's refusals before a run, C-4's
 * assembly that hands the list and k to every part): analyze-private without unreadable paths,
 * unreadable paths with command rules or a command verifier (R-5), an analyze-private run that reads,
 * searches and queries a private table, and the list and k from the config file and a profile.
 */
const PRIVATE_POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, unreadablePaths: ["private"] };
/** A people table: north 6 rows, east 5, south 3 (fewer than k 5: never shown). Synthetic values. */
const PEOPLE_CSV = [
  "person,region,amount",
  ...[1, 2, 3, 4, 5, 6].map((n) => `person-n${n},north,${n * 10}`),
  ...[1, 2, 3, 4, 5].map((n) => `person-e${n},east,${n * 3}`),
  ...[1, 2, 3].map((n) => `person-s${n},south,${n * 7}`),
].join("\n");
/** An analyze-private task over ./work/private/people.csv; `extra` changes the task file. */
function privateSetup(extra = {}, files = {}) {
  return (dir) => {
    write(dir, "work/private/people.csv", `${PEOPLE_CSV}\n`);
    write(dir, "work/public/guide.md", "# Guide\n\nReport only totals by region.\n");
    for (const [name, content] of Object.entries(files)) write(dir, name, content);
    write(dir, "task.json", task({ id: "compare-private", workflow: "analyze", workflowRef: "analyze-private", goal: "Total the amounts by region.", policy: PRIVATE_POLICY, verifiers: [{ id: "report", kind: "file_rules", rules: [{ type: "contains", path: "out/report.md", text: "# Totals" }] }], ...extra }));
    write(dir, "script.json", {
      schemaVersion: 1,
      steps: [
        { toolCalls: [{ name: "read_file", args: { path: "private/people.csv" } }] },
        { toolCalls: [{ name: "search_files", args: { path: ".", text: "north" } }] },
        { toolCalls: [{ name: "query_table", args: { path: "private/people.csv", groupBy: ["region"], operations: [{ op: "count", column: "person" }, { op: "sum", column: "amount" }] } }] },
        { toolCalls: [writeFile("out/report.md", "# Totals\n\n- north and east are shown.\n")] },
        { text: "The totals are written." },
      ],
    });
  };
}
/** The same run with the list (and k 7) in the config file, or in a profile, instead of the task file. */
const NO_LIST_POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const PRIVATE_CONFIG = {
  "config.json": { schemaVersion: 1, policy: { ...PRIVATE_POLICY, minGroupSize: 7 } },
  "profile-config.json": { schemaVersion: 1, profiles: { private: { policy: PRIVATE_POLICY } } },
};

/**
 * Run plans (C-4's assembly with the approved plan's parts; C-7b's gate): an apply with a task type
 * that does not resolve to plan "run", a digest that is not the plan's, a locked workspace (a lock
 * of a process that lives: the tool's own, by pid alone), and a planned file changed since the plan.
 */
function lockHeld(dir) {
  write(dir, "work/.codaryn/lock.json", { pid: process.pid, runId: "20200101T000000Z-0000beef", startedAt: "2020-01-01T00:00:00.000Z" });
}
function lockTaken(dir) {
  rmSync(path.join(dir, "work", ".codaryn", "lock.json"), { force: true });
}
const NOT_RUN_PLAN_CONFIG = { schemaVersion: 1, workflows: { rewrite: { tools: ["read_file", "search_files", "write_file", "propose_changes"] } } };

/** C-9a (nc-human's report 2.5): runs of every kind for `runs` and for the revert of a plan run. */
function plansOfBothKindsSetup(dir) {
  planSetup(dir);
  write(dir, "config.json", RUN_PLAN_CONFIG);
  write(dir, "work/notes.md", "# Weekly notes\n\n- The site moves next week.\n");
  write(dir, "run-plan-task.json", task({ id: "compare-run-plan", workflowRef: "rewrite", goal: "Write a summary of notes.md into summary.md." }));
  write(dir, "run-plan-script.json", { schemaVersion: 1, steps: [{ toolCalls: [{ name: "propose_changes", args: { summary: "Add the summary", files: [{ path: "summary.md", change: "create" }] } }] }, { text: "The plan is proposed." }] });
}
/** Points the run plan's task at its own script (both tasks share ./work). */
function runPlanScripts(dir, carrying) {
  if (carrying) carryingScript(dir);
  else write(dir, "script.json", JSON.parse(readFileSync(path.join(dir, "run-plan-script.json"), "utf8")));
}
const RUN_PLAN_TASK = ["--task", "run-plan-task.json", "--config", "config.json"];
/**
 * nc-human's report 2.2: a key-shaped text where the runs table shows it. A task file cannot hold one
 * (key_in_file, C-5's refusal), but a run id may look like one (RUN_ID_PATTERN): a run folder of that
 * name, made by hand, beside a run of the task. The key-shaped text is built at run time.
 */
const keyShaped = () => ["sk", "ant", "api03", "FAKEID".repeat(8)].join("-");
function keyIdSetup(dir) {
  documentSetup(DOCUMENT_STEPS)(dir);
  write(dir, "key-task.json", task({ id: keyShaped() }));
  write(dir, `work/.codaryn/runs/${keyShaped()}/journal.jsonl`, "");
}
const cleanup = (...more) => ({ args: ["cleanup", "--workspace", "work", ...more] });
const cleanupDigestOf = (step) => (ctx) => String(ctx.json(step)?.plan?.digest ?? "none").slice(0, 12);

/**
 * U-265: cleanup by age, with no clock of the comparison's own. A run or a discarded folder is selected
 * by `--older-than <days>` when now minus its start is more than that many days (the store's rule), so a
 * run made seconds before is always selected by 0 days and never by 1: the comparison's real clock is
 * far from any day's boundary, and the selection is the same in both builds and in every run.
 */
const OLDER = ["--older-than", "0"];
const DISCARDED_OLDER = ["--discarded-older-than", "0"];

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
  // U-280 (the CLI migration's C-3a: the security checks, text cleaning, the install check, run ids and
  // the model-text format move to src/app/input/): the pre-run input checks they make, in text and
  // JSON. A key field in the task file, a key value in the config file (built at run time), a variables
  // file with a byte order mark, a task file inside the workspace, a secret from a variables file
  // masked in a run, and doctor on the key field and the variables file.
  {
    name: "input-checks",
    setup: (dir) => {
      documentSetup(DOCUMENT_STEPS, {}, {
        "keyfield-task.json": task({ model: { provider: "scripted", scriptPath: "./script.json", apiKey: "placeholder" } }),
        "keyvalue-config.json": { schemaVersion: 1, note: ["sk", "ant", "api03", "FAKE".repeat(20)].join("-") },
        "bom.env": "\uFEFFCMP_NAME=1\n",
        "secret.env": `CMP_SECRET=${FAKE_SECRET}\n`,
        "secret-task.json": task({ privacy: { secretEnv: ["CMP_SECRET"] } }),
        "work/inner-task.json": task({ workspaceRoot: "." }),
      })(dir);
    },
    steps: [
      { args: ["run", "--task", "keyfield-task.json"] },
      { args: ["run", "--task", "task.json", "--config", "keyvalue-config.json"] },
      { args: ["run", "--task", "task.json", "--vars-file", "bom.env"] },
      { args: ["run", "--task", "work/inner-task.json"] },
      { args: ["run", "--task", "secret-task.json", "--vars-file", "secret.env"] },
      { args: ["doctor", "--task", "keyfield-task.json"] },
      { args: ["doctor", "--task", "task.json", "--vars-file", "bom.env", "--json"] },
    ],
  },
  {
    name: "input-checks-ko",
    lang: "ko",
    setup: documentSetup(DOCUMENT_STEPS, {}, { "keyfield-task.json": task({ model: { provider: "scripted", scriptPath: "./script.json", apiKey: "placeholder" } }), "bom.env": "\uFEFFCMP_NAME=1\n" }),
    steps: [{ args: ["run", "--task", "keyfield-task.json"] }, { args: ["run", "--task", "task.json", "--vars-file", "bom.env"] }, { args: ["doctor", "--task", "keyfield-task.json"] }],
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
  // U-167: codaryn models against the fake API's list: the table, --use by number and by id (the
  // config file it writes is compared too), the JSON, and the number asked at a terminal.
  {
    name: "models-list-use",
    api: { replies: [], models: FAKE_MODELS },
    setup: modelsSetup,
    steps: [models(), models("--json"), models("--use", "1"), models("--use", "fake-model-c", "--json"), models(), models("--use", "9")],
  },
  {
    name: "models-list-use-ko",
    lang: "ko",
    api: { replies: [], models: FAKE_MODELS },
    setup: modelsSetup,
    steps: [models(), models("--use", "1"), models()],
  },
  {
    name: "terminal-models",
    api: { replies: [], models: FAKE_MODELS },
    setup: modelsSetup,
    steps: [
      { ...models(), terminal: ASKED, answers: ["1"] },
      { ...models(), terminal: ASKED, answers: ["fake-model-c"], lang: "ko" },
      { ...models(), terminal: ASKED, answers: [""] },
      { ...models(), terminal: ASKED, answers: [""], lang: "ko" },
    ],
  },
  // U-167 (R-94 I1): the cases U-131's five texts pass through (cli-contract 18.18).
  // N2 and N4: a plan run's changes before and after its apply, and its report after.
  {
    name: "handoff-plan-applied",
    setup: planSetup,
    steps: [
      run(),
      (ctx) => ({ args: ["changes", "--task", "task.json", "--run", runIdOf(0)(ctx)] }),
      (ctx) => ({ args: ["apply", "--task", "task.json", "--run", runIdOf(0)(ctx), "--digest", digestOf(0)(ctx)] }),
      (ctx) => ({ args: ["changes", "--task", "task.json", "--run", runIdOf(0)(ctx)] }),
      (ctx) => report(runIdOf(0)(ctx)),
    ],
  },
  // N1 and N3: an analyze run's report before a verdict, the reject with its revert line, the report after.
  {
    name: "handoff-review-reject",
    setup: analyzeSetup,
    steps: [
      run(),
      (ctx) => report(runIdOf(0)(ctx)),
      (ctx) => ({ args: ["review", "--task", "task.json", "--run", runIdOf(0)(ctx), "--reject"] }),
      (ctx) => report(runIdOf(0)(ctx)),
    ],
  },
  // N5: a plan made with a task file, applied in the quick form: at a terminal (declined), then with --digest.
  {
    name: "handoff-other-task",
    setup: otherTaskSetup,
    steps: [
      run(),
      (ctx) => ({ args: [...QUICK_APPLY, "--run", runIdOf(0)(ctx)], terminal: ASKED, answers: ["n"] }),
      (ctx) => ({ args: [...QUICK_APPLY, "--run", runIdOf(0)(ctx), "--digest", digestOf(0)(ctx)] }),
    ],
  },
  // U-250 (P-2): the task-type tools' names in a run's progress lines, records and report.
  { name: "workflow-tools-inspect", setup: inspectSetup, steps: [run(), report("latest"), report("latest", "--json"), runs("--json")] },
  { name: "workflow-tools-query", setup: querySetup, steps: [run("--config", "config.json"), report("latest"), report("latest", "--json")] },
  {
    name: "workflow-tools-run-plan",
    setup: runPlanSetup,
    steps: [
      run("--config", "config.json"),
      (ctx) => ({ args: ["plan", ...RUN_PLAN, "--run", runIdOf(0)(ctx), "--json"] }),
      (ctx) => ({ args: ["plan", ...RUN_PLAN, "--run", runIdOf(0)(ctx)] }),
      (ctx) => {
        carryingScript(ctx.dir);
        return { args: ["apply", ...RUN_PLAN, "--run", runIdOf(0)(ctx), "--digest", digestOf(0)(ctx)] };
      },
      report("latest"),
      runs("--json"),
    ],
  },
  // U-256: bundle A's refusals before a run (C-3b, C-5), en and ko.
  {
    name: "private-refusals",
    setup: privateSetup({}, {
      "no-list-task.json": task({ id: "compare-private", workflow: "analyze", workflowRef: "analyze-private", goal: "Total the amounts by region.", policy: NO_LIST_POLICY }),
      "commands-task.json": task({ policy: { ...PRIVATE_POLICY, commands: [{ executable: "node", argsPrefix: ["--version"], allowExtraArgs: false }] } }),
      "verifier-task.json": task({ policy: PRIVATE_POLICY, verifiers: [{ id: "lint", kind: "command", executable: "node", args: ["--version"], expectExitCode: 0 }] }),
    }),
    steps: [
      { args: ["run", "--task", "no-list-task.json"] },
      { args: ["run", "--task", "no-list-task.json"], lang: "ko" },
      { args: ["run", "--task", "commands-task.json"] },
      { args: ["run", "--task", "commands-task.json"], lang: "ko" },
      { args: ["run", "--task", "verifier-task.json"] },
      { args: ["doctor", "--task", "no-list-task.json"] },
    ],
  },
  // U-256: an analyze-private run: the read under the list refused, the search and query_table leaving it out (C-4).
  { name: "private-run", setup: privateSetup(), steps: [run(), report("latest"), report("latest", "--json"), runs("--json")] },
  { name: "private-run-ko", lang: "ko", setup: privateSetup(), steps: [run(), report("latest")] },
  // U-256: the list and k 7 from the config file, the list from a profile (C-3b's merging).
  {
    name: "private-config-profile",
    setup: privateSetup({ policy: NO_LIST_POLICY }, PRIVATE_CONFIG),
    steps: [run("--config", "config.json"), report("latest", "--json"), run("--config", "profile-config.json", "--profile", "private"), report("latest", "--json")],
  },
  // U-256: a run plan's apply refused: the task type, the digest, a held lock, a planned file changed since.
  {
    name: "run-plan-refusals",
    setup: (dir) => {
      runPlanSetup(dir);
      write(dir, "not-run-plan-config.json", NOT_RUN_PLAN_CONFIG);
    },
    steps: [
      run("--config", "config.json"),
      (ctx) => ({ args: ["apply", "--task", "task.json", "--config", "not-run-plan-config.json", "--run", runIdOf(0)(ctx), "--digest", digestOf(0)(ctx)] }),
      (ctx) => ({ args: ["apply", ...RUN_PLAN, "--run", runIdOf(0)(ctx), "--digest", "000000000000"] }),
      (ctx) => {
        lockHeld(ctx.dir);
        carryingScript(ctx.dir);
        return { args: ["apply", ...RUN_PLAN, "--run", runIdOf(0)(ctx), "--digest", digestOf(0)(ctx)] };
      },
      (ctx) => {
        lockTaken(ctx.dir);
        write(ctx.dir, "work/summary.md", "# Written by hand meanwhile\n");
        return { args: ["apply", ...RUN_PLAN, "--run", runIdOf(0)(ctx), "--digest", digestOf(0)(ctx)] };
      },
      (ctx) => ({ args: ["plan", ...RUN_PLAN, "--run", runIdOf(0)(ctx)] }),
      runs(),
    ],
  },
  // U-256 (nc-human's report 2.5): revert --run latest, en and ko (the latestChosen line).
  {
    name: "revert-latest",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [run(), { args: ["revert", "--workspace", "work", "--run", "latest", "--dry-run"] }, { args: ["revert", "--workspace", "work", "--run", "latest"] }, { args: ["revert", "--workspace", "work", "--run", "latest"] }],
  },
  {
    name: "revert-latest-ko",
    lang: "ko",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [run(), { args: ["revert", "--workspace", "work", "--run", "latest", "--dry-run"] }, { args: ["revert", "--workspace", "work", "--run", "latest"] }, runs()],
  },
  // U-256 (nc-human's report 2.5): the revert of a plan run of each kind (appliedPlanHint), and the runs list with every kind.
  {
    name: "revert-plan-runs",
    setup: plansOfBothKindsSetup,
    steps: [
      run(),
      (ctx) => ({ args: ["apply", "--task", "task.json", "--run", runIdOf(0)(ctx), "--digest", digestOf(0)(ctx)] }),
      (ctx) => {
        runPlanScripts(ctx.dir, false);
        return { args: ["run", ...RUN_PLAN_TASK] };
      },
      (ctx) => {
        runPlanScripts(ctx.dir, true);
        return { args: ["apply", ...RUN_PLAN_TASK, "--run", runIdOf(2)(ctx), "--digest", digestOf(2)(ctx)] };
      },
      runs(),
      runs("--json"),
      { ...runs(), lang: "ko" },
      (ctx) => ({ args: ["revert", "--workspace", "work", "--run", runIdOf(0)(ctx), "--dry-run"] }),
      (ctx) => ({ args: ["revert", "--workspace", "work", "--run", runIdOf(2)(ctx), "--dry-run"] }),
      (ctx) => ({ args: ["revert", "--workspace", "work", "--run", runIdOf(2)(ctx), "--dry-run"], lang: "ko" }),
      (ctx) => ({ args: ["revert", "--workspace", "work", "--run", runIdOf(3)(ctx)] }),
    ],
  },
  // U-256 (nc-human's report 2.2): a task id holding a key shape, in the runs table and its JSON.
  { name: "runs-key-shaped-id", setup: keyIdSetup, steps: [{ args: ["run", "--task", "key-task.json"] }, run(), runs(), runs("--json"), { ...runs(), lang: "ko" }] },
  // U-256 (nc-human's report 3.4): cleanup confirmed, with discarded files and runs not reverted; a wrong digest; ko.
  {
    name: "cleanup-confirm",
    setup: planSetup,
    steps: [
      run(),
      (ctx) => ({ args: ["apply", "--task", "task.json", "--run", runIdOf(0)(ctx), "--digest", digestOf(0)(ctx)] }),
      (ctx) => cleanup("--run", `${runIdOf(0)(ctx)},${runIdOf(1)(ctx)}`, "--discarded-run", runIdOf(1)(ctx), "--json"),
      (ctx) => cleanup("--run", `${runIdOf(0)(ctx)},${runIdOf(1)(ctx)}`, "--discarded-run", runIdOf(1)(ctx), "--confirm", "000000000000"),
      (ctx) => cleanup("--run", `${runIdOf(0)(ctx)},${runIdOf(1)(ctx)}`, "--discarded-run", runIdOf(1)(ctx), "--confirm", cleanupDigestOf(2)(ctx)),
      (ctx) => cleanup("--run", `${runIdOf(0)(ctx)},${runIdOf(1)(ctx)}`, "--discarded-run", runIdOf(1)(ctx), "--confirm", cleanupDigestOf(2)(ctx), "--delete-discarded", "--include-not-reverted", "--json"),
      runs(),
    ],
  },
  {
    name: "cleanup-confirm-ko",
    lang: "ko",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [run(), (ctx) => cleanup("--run", runIdOf(0)(ctx), "--json"), (ctx) => cleanup("--run", runIdOf(0)(ctx)), (ctx) => cleanup("--run", runIdOf(0)(ctx), "--confirm", cleanupDigestOf(1)(ctx), "--include-not-reverted")],
  },
  // U-254 (the CLI migration's C-1, the app layer's types into the contracts): `changes` is the CLI's
  // one command that goes through the app layer (src/cli/changes.ts, CodarynApp.changes, toCliError).
  // Its forms the other cases leave out: the quick form, `latest`, a run that does not exist and a run
  // id that is not one, in text and JSON, in both languages.
  {
    name: "changes-forms",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [
      run(),
      { args: ["changes", "--workspace", "work", "--run", "latest"] },
      { args: ["changes", "--workspace", "work", "--run", "latest", "--json"] },
      { args: ["changes", "--task", "task.json", "--run", "latest"] },
      { args: ["changes", "--workspace", "work", "--run", NO_RUN] },
      { args: ["changes", "--workspace", "work", "--run", NO_RUN, "--json"] },
      { args: ["changes", "--workspace", "work", "--run", "../x"] },
      { args: ["changes", "--workspace", "work", "--run", "../x", "--json"] },
      { args: ["changes", "--workspace", "work"] },
    ],
  },
  {
    name: "changes-forms-ko",
    lang: "ko",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [run(), { args: ["changes", "--workspace", "work", "--run", "latest"] }, { args: ["changes", "--workspace", "work", "--run", NO_RUN] }],
  },
  // U-265: cleanup by age (--older-than, --discarded-older-than): none by 1 day, all by 0, then confirmed; and --reverted.
  {
    name: "cleanup-older-than",
    setup: planSetup,
    steps: [
      run(),
      (ctx) => ({ args: ["apply", "--task", "task.json", "--run", runIdOf(0)(ctx), "--digest", digestOf(0)(ctx)] }),
      cleanup("--older-than", "1", "--discarded-older-than", "1"),
      cleanup("--older-than", "1", "--json"),
      cleanup(...OLDER),
      cleanup(...OLDER, ...DISCARDED_OLDER, "--json"),
      (ctx) => cleanup(...OLDER, ...DISCARDED_OLDER, "--confirm", cleanupDigestOf(5)(ctx)),
      (ctx) => cleanup(...OLDER, ...DISCARDED_OLDER, "--confirm", cleanupDigestOf(5)(ctx), "--delete-discarded", "--include-not-reverted", "--json"),
      runs(),
    ],
  },
  {
    name: "cleanup-older-than-ko",
    lang: "ko",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [run(), cleanup("--older-than", "1"), cleanup(...OLDER), cleanup(...OLDER, "--json"), (ctx) => cleanup(...OLDER, "--confirm", cleanupDigestOf(3)(ctx), "--include-not-reverted")],
  },
  {
    name: "cleanup-reverted",
    setup: documentSetup(DOCUMENT_STEPS),
    steps: [
      run(),
      run(),
      (ctx) => ({ args: ["revert", "--workspace", "work", "--run", runIdOf(1)(ctx)] }),
      cleanup("--reverted"),
      cleanup("--reverted", "--json"),
      (ctx) => cleanup("--reverted", "--confirm", cleanupDigestOf(4)(ctx), "--json"),
      runs(),
    ],
  },
];
