/**
 * G-sec (U-274): a module resolve hook that gives `electron` the stand-in gsec-electron.js, for the
 * modules loaded after gsec-ipc-harness.ts registers it (module.register). Everything else resolves
 * as always.
 */

const STAND_IN = new URL("./gsec-electron.js", import.meta.url).href;

type Next = (specifier: string, context: unknown) => Promise<{ url: string }>;

export async function resolve(specifier: string, context: unknown, next: Next): Promise<{ url: string; shortCircuit?: boolean }> {
  if (specifier === "electron") return { url: STAND_IN, shortCircuit: true };
  return next(specifier, context);
}
