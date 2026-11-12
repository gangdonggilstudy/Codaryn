// Checks the GUI's dependency rules (docs/design/standalone-gui.md 7, DR-20, DR-26):
// - package.json has no runtime dependencies and exactly the approved development dependencies,
//   pinned to exact versions;
// - package-lock.json matches them, every package comes from the npm registry with an sha512
//   integrity, and no package runs an install script (electron 45 downloads its binary on first
//   use through its own install.js, which the approved install step runs once).
// The repository's .gitignore keeps every .npmrc out of Git, so `ignore-scripts` cannot be set
// in a committed file; this check takes its place.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APPROVED = { electron: "45.3.1" };
const REGISTRY = "https://registry.npmjs.org/";

const gui = fileURLToPath(new URL("../../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(gui, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(gui, "package-lock.json"), "utf8"));
const problems = [];

if (pkg.dependencies !== undefined && Object.keys(pkg.dependencies).length > 0) problems.push("package.json has runtime dependencies");
if (JSON.stringify(pkg.devDependencies) !== JSON.stringify(APPROVED)) problems.push("package.json devDependencies differ from the approved list");
if (lock.lockfileVersion !== 3) problems.push("package-lock.json is not lockfileVersion 3");
const root = lock.packages?.[""];
if (JSON.stringify(root?.devDependencies) !== JSON.stringify(APPROVED)) problems.push("the lock's root devDependencies differ from the approved list");
if (root?.dependencies !== undefined) problems.push("the lock's root has runtime dependencies");
for (const [name, version] of Object.entries(APPROVED)) {
  if (lock.packages?.[`node_modules/${name}`]?.version !== version) problems.push(`the lock does not pin ${name} ${version}`);
}
let count = 0;
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (path === "") continue;
  count += 1;
  if (entry.hasInstallScript === true) problems.push(`${path} has an install script`);
  if (typeof entry.resolved !== "string" || !entry.resolved.startsWith(REGISTRY)) problems.push(`${path} does not come from the npm registry`);
  if (typeof entry.integrity !== "string" || !entry.integrity.startsWith("sha512-")) problems.push(`${path} has no sha512 integrity`);
  if (entry.dev !== true) problems.push(`${path} is not a development package`);
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`gui lock check: ${problem}\n`);
  process.exit(1);
}
process.stdout.write(`gui lock check: ${count} packages, development only, registry, sha512, no install scripts\n`);
