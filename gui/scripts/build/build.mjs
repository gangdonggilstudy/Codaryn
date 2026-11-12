// Builds the GUI into gui/build (docs/design/standalone-gui.md 8.2): checks the renderer source
// for forbidden HTML APIs, compiles the four programs with the root TypeScript (7.0.2, M-21),
// and copies the renderer's static files. The engine itself is the root build (dist/src).

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const gui = fileURLToPath(new URL("../../", import.meta.url));
const tsc = join(gui, "..", "node_modules", "typescript", "bin", "tsc");
const build = join(gui, "build");

function fail(message) {
  process.stderr.write(`gui build: ${message}\n`);
  process.exit(1);
}

// 6.2: untrusted text goes in with textContent only.
const FORBIDDEN = [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new\s+Function\s*\(/, /setHTMLUnsafe/, /createContextualFragment/];
function rendererFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return rendererFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}
for (const file of rendererFiles(join(gui, "src", "renderer"))) {
  const text = readFileSync(file, "utf8");
  const hit = FORBIDDEN.find((pattern) => pattern.test(text));
  if (hit !== undefined) fail(`${relative(gui, file)} uses a forbidden HTML API (${hit})`);
}

if (!existsSync(tsc)) fail("the root TypeScript is missing: run npm ci in the repository root");
rmSync(build, { recursive: true, force: true });
for (const config of ["tsconfig.main.json", "tsconfig.renderer.json", "tsconfig.host.json", "tsconfig.test.json"]) {
  const result = spawnSync(process.execPath, [tsc, "-p", join(gui, config)], { cwd: gui, stdio: "inherit" });
  if (result.status !== 0) fail(`tsc failed for ${config}`);
}

for (const name of ["index.html", "styles.css"]) {
  const target = join(build, "src", "renderer", name);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(gui, "src", "renderer", name), target);
}

if (!existsSync(join(gui, "..", "dist", "src", "app", "index.js"))) {
  process.stderr.write("gui build: note: the engine is not built yet (run npm run build in the repository root)\n");
}
process.stdout.write("gui build: done\n");
