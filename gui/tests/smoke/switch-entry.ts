/**
 * R-10 L-1, L-5 (GS-15): the app started with a debugging switch or NODE_OPTIONS must end at its
 * start check. This entry is the app with a test profile and no state file; when the window loads
 * it writes build/switch-started.txt and quits with 0, which shows that the check let it through.
 * Started by scripts/build/smoke.mjs; never part of the product entry (main.ts).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { startGui } from "../../src/main/app.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));

startGui({
  // R21-I-3: the engine host reaches this machine only (the loopback fake API); never a real API.
  loopbackOnly: true,
  guiRoot: GUI,
  userDataDir: join(GUI, "build", "switch-profile"),
  stateFile: null,
  async afterLoad() {
    writeFileSync(join(GUI, "build", "switch-started.txt"), "started\n");
    app.quit();
  },
});
