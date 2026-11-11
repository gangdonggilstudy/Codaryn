/** Workspace: safe file primitives under one root. Public entry of src/workspace. */

import type { CreateWorkspace } from "../contracts/index.js";
import { nodeFileLayer } from "./file-layer.js";
import { createWorkspaceWithFileLayer } from "./workspace.js";

export const createWorkspace: CreateWorkspace = (options) =>
  createWorkspaceWithFileLayer(options, nodeFileLayer);
