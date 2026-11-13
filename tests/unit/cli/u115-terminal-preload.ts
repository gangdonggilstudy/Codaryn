/**
 * U-115 test support (not a test): preloaded into the CLI process with `--import`, it makes the CLI
 * see a terminal on the streams CODARYN_TEST_TERMINAL names ("stdout", "stderr", "stdin", comma
 * separated). Only `isTTY` changes; what is written still goes to the test's pipes.
 */

const named = (process.env["CODARYN_TEST_TERMINAL"] ?? "").split(",");
for (const name of ["stdout", "stderr", "stdin"] as const) {
  if (named.includes(name)) Object.defineProperty(process[name], "isTTY", { value: true, configurable: true });
}

export {};
