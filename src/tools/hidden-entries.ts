/**
 * U-242 (U-203, Codex V-13 M-1, M-2, V-13b): what search_files leaves out of the workspace's listing
 * (Workspace.list, ListOptions.leaveOut) when the run has unreadable paths: an entry the snapshot
 * covers by its text, and a link whose real path it covers or that cannot be resolved (a dangling
 * link, one that leaves the root). The listing skips such an entry before it counts it and never
 * reads such a folder, so the result, its `truncated` and its errors do not depend on what exists
 * under those paths. It replaces U-203's own copy of the listing (visible-list.ts).
 */

import type { ListOptions, Workspace } from "../contracts/index.js";
import type { PathSetSnapshot } from "../policy/path-set.js";

/** True when the link `relative` leads to a real path the snapshot does not cover. */
async function leadsToVisible(workspace: Workspace, relative: string, hidden: PathSetSnapshot): Promise<boolean> {
  let resolved: Awaited<ReturnType<Workspace["resolve"]>>;
  try {
    resolved = await workspace.resolve(relative, "read");
  } catch {
    return false;
  }
  return resolved.ok && !hidden.covers(resolved.path.relative);
}

/** U-242: the listing's `leaveOut` for a run's unreadable paths, resolved once (PathSet.snapshot). */
export function leaveOutUnreadable(workspace: Workspace, hidden: PathSetSnapshot): NonNullable<ListOptions["leaveOut"]> {
  return async ({ relative, link }) => hidden.covers(relative) || (link && !(await leadsToVisible(workspace, relative, hidden)));
}
