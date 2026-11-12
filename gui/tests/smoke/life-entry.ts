/**
 * R-10 L-5 (DR-8): the engine host must end with the app, when the app quits and when its main
 * process is killed. This entry is the app with a test profile and no state file. When the window
 * has loaded it writes build/life.json with the main and host process ids; with
 * CODARYN_SMOKE_LIFE=quit it then quits, with "hold" it waits to be killed by scripts/build/smoke.mjs.
 * Never part of the product entry (main.ts).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { startGui } from "../../src/main/app.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));

startGui({
  guiRoot: GUI,
  userDataDir: join(GUI, "build", "life-profile"),
  stateFile: null,
  async afterLoad({ host }) {
    const state = await host();
    const hostPid = "host" in state ? (state.host.pid ?? null) : null;
    writeFileSync(join(GUI, "build", "life.json"), `${JSON.stringify({ mainPid: process.pid, hostPid })}\n`);
    if (process.env["CODARYN_SMOKE_LIFE"] !== "hold") app.quit();
  },
});
