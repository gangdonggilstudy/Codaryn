import { unnamedWidening } from "./dialog-texts.js";
import type { EngineHost } from "./engine-client.js";
import { doctorMessageIds, isNoArgs, parseDoctorArgs, parseEntryArgs, parseProviderArgs, parseTokenArgs, parseWorkspaceArgs, toDoctorView, toHostModelList, toHostProposal, toSelectModelReply, toSettingsView, toWrittenReply, parseCreateSettingsArgs, toCreateSettingsReply, toSuggestionsReply } from "../shared/ipc.js";
import type { CreateSettingsReply, DoctorReply, ModelsReply, SelectModelReply, SettingsProposalReply, SettingsReply, SettingsWrittenReply, SuggestionsReply } from "../shared/ipc.js";
import { parseSettingsEdit } from "../shared/settings-edit.js";
import { DOCTOR_TIMEOUT_MS, MODELS_TIMEOUT_MS, SETTINGS_TIMEOUT_MS, texts } from "./ipc-context.js";
import type { IpcHandlerContext } from "./ipc-context.js";

export function createSettingsHandlers(context: IpcHandlerContext, dropTreeIds: () => void) {
  const { deps, workspaces } = context;

  const doctor = async (args: unknown[]): Promise<DoctorReply> => {
    const parsed = args.length === 1 ? parseDoctorArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    let workspace: string | null = null;
    if (parsed.workspace !== null) {
      workspace = workspaces.path(parsed.workspace);
      if (workspace === null) return { ok: false, code: "unknown_workspace" };
    }
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("doctor", { workspace }, DOCTOR_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const outcome = response.value as Record<string, unknown> | null;
    if (typeof outcome !== "object" || outcome === null) return { ok: false, code: "host_error" };
    if (outcome["ok"] !== true) {
      const error = outcome["error"] as Record<string, unknown> | undefined;
      const code = typeof error?.["code"] === "string" && /^[a-z_]{1,64}$/.test(error["code"]) ? error["code"] : "host_error";
      return { ok: false, code };
    }
    const view = toDoctorView(outcome["output"]);
    if (view === null) return { ok: false, code: "host_error" };
    const labels = await texts(state.host, deps.osLocale(), doctorMessageIds(view));
    const name = workspace === null ? null : (workspace.split(/[\\/]/).filter((part) => part.length > 0).pop() ?? workspace);
    return { ok: true, view, labels: labels?.texts ?? {}, workspaceName: name };
  };

  // GU-6 (3.10): settings, models. The config file is read and written by the app layer only.
  const settings = async (args: unknown[]): Promise<SettingsReply> => {
    if (!isNoArgs(args)) return { ok: false, code: "invalid_args" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("settings", {}, SETTINGS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    return toSettingsView(response.value, deps.envFacts());
  };

  // U-11 (3.11): the first-run guide: the config file with the defaults (never over an existing one),
  // and init's fixed suggestions for the open workspace (applied through settings proposals).
  const createSettings = async (args: unknown[]): Promise<CreateSettingsReply> => {
    const parsed = args.length === 1 ? parseCreateSettingsArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = parsed.workspace === null ? null : workspaces.path(parsed.workspace);
    if (parsed.workspace !== null && root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("createSettings", { workspace: root }, SETTINGS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const created = toCreateSettingsReply(response.value);
    if (created.ok) dropTreeIds();
    return created;
  };

  const settingsSuggestions = async (args: unknown[]): Promise<SuggestionsReply> => {
    const parsed = args.length === 1 ? parseWorkspaceArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("settingsSuggestions", { workspace: root }, SETTINGS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    return toSuggestionsReply(response.value);
  };

  // GU-6 (3.10): one edit → a proposal (the new config stays here) → applied by token, asked first when it widens.
  const proposeSettings = async (args: unknown[]): Promise<SettingsProposalReply> => {
    const edit = args.length === 1 && typeof args[0] === "object" && args[0] !== null ? parseSettingsEdit((args[0] as Record<string, unknown>)["edit"]) : null;
    if (edit === null || Object.keys(args[0] as object).some((key) => key !== "edit")) return { ok: false, code: "invalid_args" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("proposeSettings", { edit }, SETTINGS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const proposal = toHostProposal(response.value);
    if (!proposal.ok) return proposal;
    const token = deps.settingsProposals.issue({ next: proposal.next, baseDigest: proposal.baseDigest, changes: proposal.changes, widening: proposal.widening });
    return { ok: true, token, changes: proposal.changes, widening: proposal.widening, policyNarrowings: proposal.policyNarrowings };
  };

  const applySettings = async (args: unknown[]): Promise<SettingsWrittenReply> => {
    const parsed = args.length === 1 ? parseTokenArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const proposal = deps.settingsProposals.take(parsed.token);
    if (proposal === null) return { ok: false, code: "unknown_proposal" };
    const widens = proposal.widening.length > 0;
    // U-124: a widening the dialog cannot name is not written (nobody could be told what it widens).
    if (unnamedWidening(proposal.widening)) return { ok: false, code: "unknown_widening" };
    if (widens && !(await deps.confirmWidening(proposal))) return { ok: false, code: "not_confirmed" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("applySettings", { next: proposal.next, baseDigest: proposal.baseDigest, confirmWidening: widens }, SETTINGS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const written = toWrittenReply(response.value);
    if (written.ok && written.written) dropTreeIds();
    return written;
  };

  const listModels = async (args: unknown[]): Promise<ModelsReply> => {
    const parsed = args.length === 1 ? parseProviderArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    // R21-I-3: the provider's API is asked only within the limit (the screen asks on a press only).
    if (!deps.modelListLimit.begin()) return { ok: false, code: "too_many_requests" };
    deps.modelEntries.clear();
    let response: Awaited<ReturnType<EngineHost["call"]>>;
    try {
      response = await state.host.call("listModels", { provider: parsed.provider }, MODELS_TIMEOUT_MS);
    } finally {
      deps.modelListLimit.end();
    }
    if (!response.ok) return { ok: false, code: response.error.code };
    const list = toHostModelList(response.value);
    if (!list.ok) return list;
    return { ok: true, provider: list.provider, models: deps.modelEntries.issue(list.provider, list.models), current: list.current };
  };

  const selectModel = async (args: unknown[]): Promise<SelectModelReply> => {
    const parsed = args.length === 1 ? parseEntryArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const chosen = deps.modelEntries.resolve(parsed.entry);
    if (chosen === null) return { ok: false, code: "unknown_entry" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("selectModel", { provider: chosen.provider, model: chosen.id }, MODELS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    return toSelectModelReply(response.value);
  };

  return { doctor, settings, createSettings, settingsSuggestions, proposeSettings, applySettings, listModels, selectModel };
}
