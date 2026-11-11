/**
 * How a command is started on Windows (task G1): PATH and PATHEXT search in the child
 * environment, `.exe` without a shell, `.cmd`/`.bat` through `cmd.exe /d /s /c` with a narrow
 * character set, and no shell for scripts inside the workspace. A fake file layer is used, so
 * these tests run on every OS.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { planWindowsLaunch } from "../../../src/tools/index.js";
import type { ExecutableFileSystem, WindowsLaunchInput, WindowsLaunchPlan } from "../../../src/tools/index.js";

const CMD = "C:\\Windows\\System32\\cmd.exe";
const NODE_DIR = "C:\\Program Files\\nodejs";
const NPM_CMD = `${NODE_DIR}\\npm.cmd`;
const WS = "D:\\ws";

/**
 * Case-insensitive fake file layer. `links` maps a path to the real path it points to.
 * Other paths (directories such as the workspace root) are their own real path.
 * Every file probe is recorded.
 */
function fakeFiles(files: readonly string[], links: Readonly<Record<string, string>> = {}) {
  const real = new Map<string, string>();
  for (const file of files) real.set(file.toLowerCase(), file);
  const linked = new Map<string, string>();
  for (const [from, to] of Object.entries(links)) linked.set(from.toLowerCase(), to);
  const probes: string[] = [];
  const fileSystem: ExecutableFileSystem = {
    async isFile(path) {
      probes.push(path);
      const key = path.toLowerCase();
      return real.has(key) || linked.has(key);
    },
    async realpath(path) {
      const key = path.toLowerCase();
      return linked.get(key) ?? real.get(key) ?? path;
    },
  };
  return { fileSystem, probes };
}

function input(overrides: Partial<WindowsLaunchInput> & { files?: readonly string[] }): WindowsLaunchInput {
  const { files, ...rest } = overrides;
  return {
    executable: "npm",
    args: [],
    cwdAbsolute: WS,
    env: { Path: `${NODE_DIR};C:\\Windows\\System32`, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
    workspaceRoot: WS,
    systemRoot: "C:\\Windows",
    fileSystem: fakeFiles(files ?? [NPM_CMD, `${NODE_DIR}\\node.exe`]).fileSystem,
    ...rest,
  };
}

function launchOf(plan: WindowsLaunchPlan) {
  assert.equal(plan.ok, true, JSON.stringify(plan));
  if (!plan.ok) throw new Error("unreachable");
  return plan.launch;
}

function refusal(plan: WindowsLaunchPlan): string {
  assert.equal(plan.ok, false, JSON.stringify(plan));
  return plan.ok ? "" : plan.message;
}

// ---- PATH and PATHEXT search ----

test("G1: an .exe found on PATH starts directly, without a shell and with the args unchanged", async () => {
  const env = { PATH: "C:\\a;C:\\b", PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  const launch = launchOf(
    await planWindowsLaunch(
      input({ executable: "tool", args: ["a&b", "%x%", '"q"'], env, files: ["C:\\b\\tool.exe"] }),
    ),
  );
  assert.equal(launch.file, "C:\\b\\tool.exe");
  assert.deepEqual(launch.args, ["a&b", "%x%", '"q"']);
  assert.equal(launch.verbatimArguments, false);
  assert.deepEqual(launch.env, env);
});

test("G1: the first PATH directory wins, and PATHEXT order decides inside one directory", async () => {
  const files = ["C:\\a\\tool.cmd", "C:\\b\\tool.exe", "C:\\c\\both.exe", "C:\\c\\both.cmd"];
  const env = (pathext: string) => ({ PATH: "C:\\a;C:\\b;C:\\c", PATHEXT: pathext });
  const first = launchOf(await planWindowsLaunch(input({ executable: "tool", env: env(".EXE;.CMD"), files })));
  assert.equal(first.file, CMD);
  assert.match(first.args[3] ?? "", /^""C:\\a\\tool\.cmd"/);
  const exeFirst = launchOf(await planWindowsLaunch(input({ executable: "both", env: env(".EXE;.CMD"), files })));
  assert.equal(exeFirst.file, "C:\\c\\both.exe");
  const cmdFirst = launchOf(await planWindowsLaunch(input({ executable: "both", env: env(".CMD;.EXE"), files })));
  assert.equal(cmdFirst.file, CMD);
});

test("G1: PATH and PATHEXT are read from the child environment without case; no PATHEXT uses the default", async () => {
  const files = ["C:\\t\\tool.exe", "C:\\t\\tool.vbs"];
  const lower = launchOf(
    await planWindowsLaunch(input({ executable: "tool", env: { path: "C:\\t", pathext: ".exe" }, files })),
  );
  assert.equal(lower.file, "C:\\t\\tool.exe");
  const noExt = launchOf(await planWindowsLaunch(input({ executable: "tool", env: { Path: "C:\\t" }, files })));
  assert.equal(noExt.file, "C:\\t\\tool.exe");
  // PATH is taken from the child environment only: without it nothing is found.
  assert.match(refusal(await planWindowsLaunch(input({ executable: "tool", env: {}, files }))), /\(ENOENT\)/);
});

test("G1: relative, empty and quoted PATH entries; the working directory is never searched", async () => {
  const files = [`${WS}\\tool.exe`, `${WS}\\bin\\tool.exe`, "C:\\Program Files\\x\\tool.exe"];
  const { fileSystem, probes } = fakeFiles(files);
  const env = { PATH: '.;bin;;"C:\\Program Files\\x"', PATHEXT: ".EXE" };
  const launch = launchOf(await planWindowsLaunch(input({ executable: "tool", env, fileSystem })));
  assert.equal(launch.file, "C:\\Program Files\\x\\tool.exe");
  assert.deepEqual(probes, ["C:\\Program Files\\x\\tool.exe"]);

  const onlyRelative = await planWindowsLaunch(input({ executable: "tool", env: { PATH: ".;bin", PATHEXT: ".EXE" }, files }));
  assert.equal(refusal(onlyRelative), "could not start process (ENOENT)");
});

test("G1: a name with a directory part is resolved against the working directory, not PATH", async () => {
  const files = [`${WS}\\tools\\run.exe`, "C:\\t\\run.exe", "C:\\abs\\x.exe"];
  const env = { PATH: "C:\\t", PATHEXT: ".EXE" };
  // No workspace root, so only the lookup is under test here; T-4 refuses these with a root.
  const relative = launchOf(await planWindowsLaunch(input({ executable: ".\\tools\\run", env, files, workspaceRoot: undefined })));
  assert.equal(relative.file, `${WS}\\tools\\run.exe`);
  const slash = launchOf(await planWindowsLaunch(input({ executable: "tools/run.exe", env, files, workspaceRoot: undefined })));
  assert.equal(slash.file, `${WS}\\tools\\run.exe`);
  const absolute = launchOf(await planWindowsLaunch(input({ executable: "C:\\abs\\x.exe", env, files })));
  assert.equal(absolute.file, "C:\\abs\\x.exe");
});

test("G1: unknown names, drive-relative names and an extension-less file are not found", async () => {
  const files = ["C:\\t\\npm", "C:\\t\\x.exe"];
  const env = { PATH: "C:\\t", PATHEXT: ".EXE;.CMD" };
  for (const executable of ["no-such-tool", "C:x.exe", "npm"]) {
    assert.equal(
      refusal(await planWindowsLaunch(input({ executable, env, files }))),
      "could not start process (ENOENT)",
      executable,
    );
  }
});

// ---- .cmd and .bat through cmd.exe ----

test("G1: a .cmd runs as cmd.exe /d /s /c with the quoted script path and the args as given", async () => {
  const args = ["test", "--", "--x=1", "C:\\p\\q", "./t/x.js", "@scope/pkg@1.0.0", "~y", "#z", "+w", "a:b", "-"];
  const launch = launchOf(await planWindowsLaunch(input({ args })));
  assert.equal(launch.file, CMD);
  assert.deepEqual(launch.args, ["/d", "/s", "/c", `""${NPM_CMD}" ${args.join(" ")}"`]);
  assert.equal(launch.verbatimArguments, true);
  // cmd.exe must not look for nested commands in the working directory (the workspace).
  assert.equal(launch.env["NoDefaultCurrentDirectoryInExePath"], "1");
  assert.equal(launch.env["Path"], `${NODE_DIR};C:\\Windows\\System32`);
});

test("G1: .bat files and upper-case extensions take the same branch", async () => {
  const files = ["C:\\t\\a.bat", "C:\\t\\B.CMD"];
  const env = { PATH: "C:\\t", PATHEXT: ".BAT;.CMD" };
  const bat = launchOf(await planWindowsLaunch(input({ executable: "a", args: ["x"], env, files })));
  assert.deepEqual(bat.args, ["/d", "/s", "/c", '""C:\\t\\a.bat" x"']);
  const upper = launchOf(await planWindowsLaunch(input({ executable: "B.CMD", env, files })));
  assert.deepEqual(upper.args, ["/d", "/s", "/c", '""C:\\t\\B.CMD""']);
});

test("G1: any argument with a cmd metacharacter or a character outside the allowed set is refused", async () => {
  const attempts = [
    "a&calc",
    "a && calc",
    "x|more",
    "a>out.txt",
    "a<in.txt",
    "a^&b",
    "%PATH%",
    "%~dp0",
    "!x!",
    '"',
    'a" & calc & "',
    "(a)",
    "a)",
    "a\nb",
    "a\r\ncalc",
    "a\tb",
    "a b",
    "",
    "a;b",
    "a,b",
    "*.js",
    "a?",
    "`x`",
    "'x'",
    "$x",
    "[x]",
    "한글",
    "\uFF02calc\uFF02",
    "a\u0000b",
  ];
  for (const bad of attempts) {
    const message = refusal(await planWindowsLaunch(input({ args: ["test", bad] })));
    assert.match(message, /^could not start process \(script_refused\): argument 2 /, JSON.stringify(bad));
    if (bad.length > 1) assert.ok(!message.includes(bad), "the refused argument is not echoed");
  }
});

test("G1: a script path with metacharacters or outside the allowed form is refused", async () => {
  const paths = [
    "C:\\Program Files (x86)\\nodejs\\npm.cmd",
    "C:\\a&b\\npm.cmd",
    "C:\\100%\\npm.cmd",
    "C:\\x!y\\npm.cmd",
    "C:\\x^y\\npm.cmd",
    "C:\\사용자\\npm.cmd",
    "\\\\server\\share\\npm.cmd",
  ];
  for (const script of paths) {
    const message = refusal(await planWindowsLaunch(input({ executable: script, files: [script] })));
    assert.match(message, /^could not start process \(script_refused\): the script path /, script);
  }
});

test("G1: a .cmd or .bat inside the workspace is refused, however it is reached", async () => {
  const env = { PATH: `C:\\t;${WS}\\scripts`, PATHEXT: ".EXE;.BAT;.CMD" };
  const cases: { executable: string; files: string[]; links?: Record<string, string>; root?: string }[] = [
    { executable: ".\\build.cmd", files: [`${WS}\\build.cmd`] },
    { executable: "build", files: [`${WS}\\scripts\\build.bat`] },
    { executable: "sub\\x", files: [`${WS}\\sub\\x.cmd`] },
    { executable: "x", files: ["d:\\WS\\scripts\\x.cmd"], root: "D:\\ws" },
    // Found outside, but the real file is in the workspace.
    { executable: "x", files: [`${WS}\\real.cmd`], links: { "C:\\t\\x.cmd": `${WS}\\real.cmd` } },
    // Found through the workspace, but the real file is outside.
    { executable: "link\\x.cmd", files: ["C:\\out\\x.cmd"], links: { [`${WS}\\link\\x.cmd`]: "C:\\out\\x.cmd" } },
  ];
  for (const item of cases) {
    const { fileSystem } = fakeFiles(item.files, item.links);
    const plan = await planWindowsLaunch(
      input({ executable: item.executable, env, fileSystem, workspaceRoot: item.root ?? WS }),
    );
    assert.equal(
      refusal(plan),
      "could not start process (script_refused): .cmd and .bat files inside the workspace are not run",
      item.executable,
    );
  }
  // A sibling directory that only shares the name prefix is outside.
  const sibling = launchOf(
    await planWindowsLaunch(input({ executable: "x", env: { PATH: "D:\\ws2", PATHEXT: ".CMD" }, files: ["D:\\ws2\\x.cmd"] })),
  );
  assert.equal(sibling.file, CMD);
});

test("G1: without a known workspace root, scripts are refused and .exe files still start", async () => {
  const message = refusal(await planWindowsLaunch(input({ workspaceRoot: undefined })));
  assert.match(message, /^could not start process \(script_refused\): the workspace root is not known/);
  const node = launchOf(await planWindowsLaunch(input({ executable: "node", workspaceRoot: undefined })));
  assert.equal(node.file, `${NODE_DIR}\\node.exe`);
});

test("G1: other file types, trailing-dot names and links to non-scripts are refused", async () => {
  const env = { PATH: "C:\\t", PATHEXT: ".PS1;.VBS;.JS;.EXE;.CMD" };
  const files = ["C:\\t\\a.ps1", "C:\\t\\b.vbs", "C:\\t\\c.js", "C:\\t\\d.cmd.", "C:\\t\\e.cmd ", "C:\\t\\y.txt"];
  for (const executable of ["a", "b", "c", "d.cmd.", "e.cmd "]) {
    assert.match(
      refusal(await planWindowsLaunch(input({ executable, env, files }))),
      /^could not start process \(unsupported_type\): /,
      executable,
    );
  }
  const { fileSystem } = fakeFiles(files, { "C:\\t\\f.cmd": "C:\\t\\y.txt" });
  assert.match(
    refusal(await planWindowsLaunch(input({ executable: "f", env, fileSystem }))),
    /^could not start process \(unsupported_type\): /,
  );
});

// ---- T-4: any executable that resolves into the workspace is refused, whatever its type ----

const EXE_REFUSED = "could not start process (executable_refused): executables inside the workspace are not run";

test("T-4: an .exe or .com found through a PATH entry inside the workspace is refused (review F6-7)", async () => {
  // The review's input: workspace D:\work\proj, its tools folder on PATH, `npm` asked for.
  const root = "D:\\work\\proj";
  const env = { PATH: `${root}\\tools;C:\\Program Files\\nodejs`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  for (const file of [`${root}\\tools\\npm.exe`, `${root}\\tools\\npm.com`]) {
    const plan = await planWindowsLaunch(
      input({ executable: "npm", env, cwdAbsolute: root, workspaceRoot: root, files: [file, NPM_CMD] }),
    );
    assert.equal(refusal(plan), EXE_REFUSED, file);
  }
});

test("T-4: a name with a directory part that resolves into the workspace is refused", async () => {
  const env = { PATH: "C:\\t", PATHEXT: ".EXE;.COM" };
  const files = [`${WS}\\tools\\run.exe`, `${WS}\\sub\\bin\\tool.exe`, `${WS}\\x.com`, "C:\\t\\run.exe"];
  for (const [executable, cwdAbsolute] of [
    [".\\tools\\run", WS],
    ["tools/run.exe", WS],
    ["bin\\tool.exe", `${WS}\\sub`],
    ["..\\x.com", `${WS}\\sub`],
    [`${WS}\\tools\\run.exe`, WS],
  ] as const) {
    assert.equal(refusal(await planWindowsLaunch(input({ executable, cwdAbsolute, env, files }))), EXE_REFUSED, executable);
  }
});

test("T-4: links are judged by both the found path and the real path; case does not matter", async () => {
  const env = { PATH: "C:\\t;C:\\u", PATHEXT: ".EXE" };
  // Found outside, real file inside the workspace.
  const intoWorkspace = fakeFiles([`${WS}\\real.exe`], { "C:\\t\\tool.exe": `${WS}\\real.exe` });
  assert.equal(
    refusal(await planWindowsLaunch(input({ executable: "tool", env, fileSystem: intoWorkspace.fileSystem }))),
    EXE_REFUSED,
  );
  // Found through the workspace, real file outside.
  const outOfWorkspace = fakeFiles(["C:\\out\\x.exe"], { [`${WS}\\link\\x.exe`]: "C:\\out\\x.exe" });
  assert.equal(
    refusal(await planWindowsLaunch(input({ executable: "link\\x.exe", env, fileSystem: outOfWorkspace.fileSystem }))),
    EXE_REFUSED,
  );
  // A PATH entry spelled with another case.
  const otherCase = { PATH: "d:\\WS\\bin", PATHEXT: ".EXE" };
  assert.equal(
    refusal(await planWindowsLaunch(input({ executable: "tool", env: otherCase, files: ["d:\\WS\\bin\\tool.exe"] }))),
    EXE_REFUSED,
  );
});

test("T-4: relative PATH entries never lead to a workspace executable", async () => {
  const files = [`${WS}\\node.exe`, `${WS}\\bin\\node.exe`, "C:\\nodejs\\node.exe"];
  const { fileSystem, probes } = fakeFiles(files);
  const env = { PATH: ".;bin;.\\bin;C:\\nodejs", PATHEXT: ".EXE" };
  const launch = launchOf(await planWindowsLaunch(input({ executable: "node", env, fileSystem })));
  assert.equal(launch.file, "C:\\nodejs\\node.exe");
  assert.ok(probes.every((probe) => !probe.toLowerCase().startsWith("d:\\ws")), JSON.stringify(probes));
});

test("T-4: executables outside the workspace still start, including a sibling that shares the name prefix", async () => {
  const env = { PATH: "D:\\ws2;C:\\nodejs", PATHEXT: ".EXE" };
  const sibling = launchOf(await planWindowsLaunch(input({ executable: "tool", env, files: ["D:\\ws2\\tool.exe"] })));
  assert.equal(sibling.file, "D:\\ws2\\tool.exe");
  const node = launchOf(await planWindowsLaunch(input({ executable: "node", env, files: ["C:\\nodejs\\node.exe"] })));
  assert.equal(node.file, "C:\\nodejs\\node.exe");
  assert.equal(node.verbatimArguments, false);
});

