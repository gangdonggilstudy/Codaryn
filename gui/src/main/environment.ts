/**
 * The engine host's environment (docs/design/standalone-gui.md 4.3): a copy of the main process's
 * environment without the variables that would load code into Node or turn Electron into Node.
 * Names are compared without case, as Windows treats them. The main process never reads the
 * values; it only copies them.
 */

export const REMOVED_HOST_VARIABLES: readonly string[] = ["NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE"];

export function hostEnvironment(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const removed = new Set(REMOVED_HOST_VARIABLES.map((name) => name.toUpperCase()));
  const copy: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || removed.has(name.toUpperCase())) continue;
    copy[name] = value;
  }
  return copy;
}
