// U-135: preloaded into a CLI process with `node --import` by scripts/compare-cli-boards.mjs for
// its terminal cases. It makes the CLI see a terminal on the streams CODARYN_TEST_TERMINAL names
// ("stdout", "stderr", "stdin", comma separated), as the unit tests' preloads do
// (tests/unit/cli/u110-terminal-preload.ts). Only `isTTY` changes: readline then reads keys as at a
// terminal (Ctrl+C is the byte 0x03), and what is written still goes to the tool's pipes.
// An imitation: no console or pty is used.

const named = (process.env.CODARYN_TEST_TERMINAL ?? "").split(",");
for (const name of ["stdout", "stderr", "stdin"]) {
  if (named.includes(name)) Object.defineProperty(process[name], "isTTY", { value: true, configurable: true });
}
