/**
 * GU-2: a workspace folder named on the command line (`Codaryn.exe D:\work\notes`, docs/design/
 * standalone-gui.md 3.2), at the first start or passed on by a second start. The main process
 * still checks that it is a directory before it issues a handle.
 */

import { posix, win32 } from "node:path";

/**
 * The folder argument: the first argument after the program (and, when not packaged, the app path
 * Electron is given) that is not a switch, resolved against `cwd`. Null when there is none.
 */
export function folderArgument(argv: readonly string[], packaged: boolean, cwd: string, platform: NodeJS.Platform): string | null {
  const paths = platform === "win32" ? win32 : posix;
  const args = argv.slice(packaged ? 1 : 2);
  const folder = args.find((arg) => arg.length > 0 && !arg.startsWith("-"));
  if (folder === undefined || folder.length > 4096 || folder.includes("\0")) return null;
  return paths.resolve(cwd, folder);
}
