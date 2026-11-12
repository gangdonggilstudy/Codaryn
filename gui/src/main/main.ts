/** Entry of the GUI (`electron .`). Production code path only: no test hooks, no switches. */

import { fileURLToPath } from "node:url";
import { startGui } from "./app.js";

// This file is build/src/main/main.js; the gui package is three levels up.
startGui({ guiRoot: fileURLToPath(new URL("../../../", import.meta.url)) });
