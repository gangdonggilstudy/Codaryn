/**
 * Workflow definitions that ship with Codaryn, and `resolveWorkflow` (G-F, GT-D12).
 * Data and one pure function: no file, environment or engine access. The engine never sees a
 * workflow's name; the CLI resolves a definition into the task's explicit fields.
 * Design: docs/design/general-tasks.md sections 4 and 5; contract: src/contracts/workflow.ts.
 */

import {
  ALL_TOOL_DESCRIPTORS,
  ANALYZE_PRIVATE_WORKFLOW_ID,
  LEGACY_WORKFLOW_SETTINGS,
  MAX_REVIEW_CHECKLIST_ITEMS,
  MAX_REVIEW_CHECKLIST_ITEM_CHARS,
  MAX_WORKFLOW_INSTRUCTIONS_CHARS,
  PRIVATE_REVIEW_ITEM,
  TOOL_NAMES,
} from "../contracts/index.js";
import type {
  AnyToolName,
  BuiltinWorkflowId,
  HumanReviewConfig,
  ResolveWorkflow,
  ResolveWorkflowOutcome,
  WorkflowDefinition,
  WorkflowSettings,
} from "../contracts/index.js";

/**
 * The built-in definitions (section 5). Each holds only defaults and ceilings; a profile and the
 * task narrow them as `resolveWorkflow` allows.
 * - general: the legacy behaviour, under a name.
 * - code: the four built-in tools; commands as the policy allows.
 * - document: read, search and write; no command tool.
 * - analyze: read, search and write; ends with a person's review after the automatic checks
 *   (GT-D7). Raw rows reach the model, so personal data is out of scope (GT-D8): that is
 *   analyze-private's. U-210 (P-2): query_table too, for large tables; k applies to unreadable
 *   tables only, so it gives every group of any other table.
 * - organize: read-only tools and `propose_plan`; a person approves the plan and the applier moves
 *   or discards files (GT-D4, GT-D5). No command may be allowed (GT-D10).
 * - analyze-private (U-210, bundle A P-1, P-3; GT-D8 (b), DR-23): the tables with personal data lie
 *   under the run's unreadable paths and reach the model only as query_table's aggregates (DR-70).
 *   Read and search stay for the files outside them (the gate and the listing tools keep the ones
 *   under them away, U-203). No command, since a command can read any file (R-5). A person's review
 *   with analyze's two items and PRIVATE_REVIEW_ITEM. Resolved only with an unreadable path.
 */
export const BUILTIN_WORKFLOWS: { readonly [Id in BuiltinWorkflowId]: WorkflowDefinition } = Object.freeze({
  general: {
    label: "General task",
    tools: TOOL_NAMES,
  },
  code: {
    label: "Code change",
    tools: TOOL_NAMES,
    instructions: "Change only what the goal asks for. Keep the existing style. Run the allowed checks before you finish.",
  },
  document: {
    label: "Document writing",
    tools: ["read_file", "search_files", "write_file"],
    instructions:
      "Keep lines you were not asked to change. Do not create files outside the paths named in the goal. Write UTF-8 text only.",
  },
  analyze: {
    label: "Data analysis",
    tools: ["read_file", "search_files", "query_table", "write_file"],
    instructions:
      "Read the input tables and write the result table and the report the goal names. Compute every number from the input tables. Keep the input files unchanged.",
    completion: "human_review",
    humanReview: {
      checklist: ["The report's interpretation matches the result table.", "No input data the goal names is missing from the analysis."],
    },
  },
  organize: {
    label: "File organizing",
    tools: ["read_file", "search_files", "inspect_files", "propose_plan"],
    instructions:
      "Decide how the files should be arranged as the goal says. Propose exactly one plan with propose_plan. You cannot change files yourself.",
    plan: "apply",
    allowCommands: false,
    policy: {
      commands: [],
      network: "deny",
      destructive: "deny",
      restorePathTokens: false,
      planActions: ["move", "discard"],
    },
    limits: { maxModelTurns: 8, maxToolCalls: 40 },
  },
  "analyze-private": {
    label: "Private data analysis",
    tools: ["read_file", "search_files", "query_table", "write_file"],
    instructions:
      "The input tables are not readable. Use query_table for every number. Write only the result table and the report the goal names. Do not write values that identify a person.",
    completion: "human_review",
    humanReview: {
      checklist: ["The report's interpretation matches the result table.", "No input data the goal names is missing from the analysis.", PRIVATE_REVIEW_ITEM],
    },
    allowCommands: false,
  },
} satisfies { readonly [Id in BuiltinWorkflowId]: WorkflowDefinition });

/** True when the instructions or a checklist entry is over its limit. */
function checklistProblem(review: HumanReviewConfig): boolean {
  return (
    review.checklist.length === 0 ||
    review.checklist.length > MAX_REVIEW_CHECKLIST_ITEMS ||
    review.checklist.some((item) => item.trim().length === 0 || [...item].length > MAX_REVIEW_CHECKLIST_ITEM_CHARS)
  );
}

/**
 * GT-D1, GT-D2: the workflow settings of a task. Order: the definition's values (from the task's
 * `workflowRef`, else the profile's), then the task's own fields, under these ceilings:
 * - `tools` only narrows (`tool_not_allowed`); with `allowCommands: false` `run_command` is dropped;
 * - a definition's `plan: "apply"` or (U-175, DR-69 B-1) `plan: "run"` cannot become "none"
 *   (`plan_weakened`): both ask a person before anything is written. U-180 (R-99 L-2): nor the
 *   other of the two: a task keeps a definition's plan mode, and sets one only under "none";
 * - U-180 (R-99 L-2): under a plan mode, no plan tool of another mode (ToolDescriptor.planMode) in
 *   the tools (`tool_not_allowed`, at the task's tool or at the definition's tools): it would
 *   never be offered;
 * - `allowCommands: false` admits no command rule in the effective policy (`commands_not_allowed`);
 * - U-210 (P-1): `analyze-private` needs an unreadable path in the run (input.unreadablePaths,
 *   `unreadable_paths_required` at `policy.unreadablePaths`);
 * - `completion: "human_review"` needs a checklist and "verifiers" admits none given by the task
 *   (`review_without_checklist`, `checklist_without_review`); a definition's checklist is dropped
 *   when the task chooses "verifiers";
 * - length limits (`instructions_too_long`, `checklist_too_long`).
 * Without a definition the base is LEGACY_WORKFLOW_SETTINGS, so a task with none of the fields
 * resolves to exactly the legacy settings. `field` names a schema position, never a value.
 */
export const resolveWorkflow: ResolveWorkflow = (input): ResolveWorkflowOutcome => {
  const fromTask = input.task.workflowRef !== undefined;
  const ref = input.task.workflowRef ?? input.profileWorkflowRef ?? null;
  let base: WorkflowSettings = LEGACY_WORKFLOW_SETTINGS;
  let allowCommands = true;
  if (ref !== null) {
    if (!Object.hasOwn(input.definitions, ref)) {
      return { ok: false, problem: "unknown_workflow", field: fromTask ? "workflowRef" : "profiles.workflowRef" };
    }
    const definition = input.definitions[ref] as WorkflowDefinition;
    if (definition.instructions !== undefined && [...definition.instructions].length > MAX_WORKFLOW_INSTRUCTIONS_CHARS) {
      return { ok: false, problem: "instructions_too_long", field: "workflows.instructions" };
    }
    base = {
      tools: definition.tools,
      instructions: definition.instructions ?? null,
      plan: definition.plan ?? "none",
      completion: definition.completion ?? "verifiers",
      humanReview: definition.humanReview ?? null,
    };
    allowCommands = definition.allowCommands ?? true;
  }

  const task = input.task;
  let tools: readonly AnyToolName[] = base.tools;
  if (task.tools !== undefined) {
    const outside = task.tools.findIndex((tool) => !base.tools.includes(tool));
    if (outside !== -1) return { ok: false, problem: "tool_not_allowed", field: `tools[${outside}]` };
    tools = task.tools.filter((tool, index) => task.tools?.indexOf(tool) === index);
  }
  if (!allowCommands) {
    if (input.commandRules > 0) return { ok: false, problem: "commands_not_allowed", field: "policy.commands" };
    tools = tools.filter((tool) => tool !== "run_command");
  }
  // U-210 (P-1): no private data analysis without data kept from the agent. A config entry cannot
  // take a built-in id, so the id names the built-in.
  if (ref === ANALYZE_PRIVATE_WORKFLOW_ID && (input.unreadablePaths ?? []).length === 0) {
    return { ok: false, problem: "unreadable_paths_required", field: "policy.unreadablePaths" };
  }

  // U-175, U-180 (R-99 L-2): a definition's plan mode stays; a task sets one only under "none".
  if (base.plan !== "none" && task.plan !== undefined && task.plan !== base.plan) return { ok: false, problem: "plan_weakened", field: "plan" };
  const plan = task.plan ?? base.plan;
  if (plan !== "none") {
    const otherMode = (name: AnyToolName): boolean => {
      const descriptor = ALL_TOOL_DESCRIPTORS[name];
      return descriptor.endsRun === "plan" && descriptor.planMode !== plan;
    };
    if (task.tools !== undefined) {
      const index = task.tools.findIndex(otherMode);
      if (index !== -1) return { ok: false, problem: "tool_not_allowed", field: `tools[${index}]` };
    } else if (tools.some(otherMode)) {
      return { ok: false, problem: "tool_not_allowed", field: "workflows.tools" };
    }
    // U-224: the mode's own plan tool must be among the tools, or the run can never store a plan.
    const ownPlanTool = (name: AnyToolName): boolean => {
      const descriptor = ALL_TOOL_DESCRIPTORS[name];
      return descriptor.endsRun === "plan" && descriptor.planMode === plan;
    };
    if (!tools.some(ownPlanTool)) {
      const field = base.tools.some(ownPlanTool) ? "tools" : base.plan === "none" ? "plan" : "workflows.tools";
      return { ok: false, problem: "plan_tool_missing", field };
    }
  }

  const completion = task.completion ?? base.completion;
  let humanReview: HumanReviewConfig | null;
  if (completion === "human_review") {
    humanReview = task.humanReview ?? base.humanReview;
    if (humanReview === null) return { ok: false, problem: "review_without_checklist", field: "humanReview" };
  } else {
    if (task.humanReview !== undefined) return { ok: false, problem: "checklist_without_review", field: "humanReview" };
    humanReview = null;
  }
  if (humanReview !== null && checklistProblem(humanReview)) {
    return { ok: false, problem: "checklist_too_long", field: "humanReview.checklist" };
  }

  // A task with no workflow at all keeps the legacy settings object, field for field.
  if (ref === null && task.tools === undefined && task.plan === undefined && task.completion === undefined && task.humanReview === undefined) {
    return { ok: true, workflowRef: null, settings: LEGACY_WORKFLOW_SETTINGS };
  }
  return { ok: true, workflowRef: ref, settings: { tools, instructions: base.instructions, plan, completion, humanReview } };
};

/** Built-ins and the config file's definitions, by id. A config id never equals a built-in one (checked when parsed). */
export function workflowDefinitions(configWorkflows: { readonly [id: string]: WorkflowDefinition } | undefined): {
  readonly [id: string]: WorkflowDefinition;
} {
  return { ...BUILTIN_WORKFLOWS, ...(configWorkflows ?? {}) };
}
