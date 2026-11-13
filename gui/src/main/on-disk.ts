/**
 * U-123 (R-87 U-66 L1): whether a plain relative path names a file or a folder inside a workspace
 * now, looked at with lstat (a link or junction is not one; nothing is followed). A path the app
 * layer showed masked (a key shape as [key]) names nothing there.
 */

import { lstat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

export async function pathOnDisk(root: string, path: string): Promise<boolean> {
  const target = join(root, ...path.split("/"));
  const inside = relative(root, target);
  if (inside.length === 0 || inside.startsWith("..") || isAbsolute(inside)) return false;
  try {
    const stat = await lstat(target);
    return stat.isFile() || stat.isDirectory();
  } catch {
    return false;
  }
}
