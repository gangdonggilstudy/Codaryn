/**
 * GU-2: a workspace folder named on the command line (`Codaryn.exe D:\work\notes`, docs/design/
 * standalone-gui.md 3.2), at the first start or passed on by a second start. The main process
 * still checks that it is a directory before it issues a handle.
 */

import { posix, win32 } from "node:path";
import { isLocalPathSyntax } from "./node-path.js";

/**
 * The folder argument: the first argument after the program (and, when not packaged, the app path
 * Electron is given) that is not a switch, resolved against `cwd`. Null when there is none, and
 * (R10b-L-2) when it resolves to a network, pipe or device path: such a path is never touched.
 */
export function folderArgument(argv: readonly string[], packaged: boolean, cwd: string, platform: NodeJS.Platform): string | null {
  const paths = platform === "win32" ? win32 : posix;
  const args = argv.slice(packaged ? 1 : 2);
  const folder = args.find((arg) => arg.length > 0 && !arg.startsWith("-"));
  if (folder === undefined || folder.length > 4096 || folder.includes("\0")) return null;
  if (!isLocalPathSyntax(folder, platform)) return null;
  const resolved = paths.resolve(cwd, folder);
  return isLocalPathSyntax(resolved, platform) ? resolved : null;
}
