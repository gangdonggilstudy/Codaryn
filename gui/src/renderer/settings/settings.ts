/**
 * GU-6: the settings screen (docs/design/standalone-gui.md 3.10): where the config file is and who
 * chose it, the language, the model and how to choose one, the profiles (to look at), the task
 * kinds, the permission rules (limits, allowed commands, protected paths), the secret names and
 * whether a key is available.
 * - A change is one edit at a time, in two steps (3.10, 6.6): the window sends the edit, the app
 *   layer proposes the new file and judges what widens, the window shows that, and "Write" sends
 *   only the main process's token. When the change widens, the main process asks in an OS dialog
 *   whose default is "do not write"; this screen's notice is not the confirmation.
 * - Secret variables are names only; there is no value field (S-3).
 * - Providers come from the contract's table through the engine host (DR-22): the screen shows each
 *   one's key variable (set or not, never its value) and model, and the person chooses the one the
 *   config names. Each provider the app layer lists (CONNECTED_MODEL_PROVIDERS) has its own model
 *   list button; the list and the choice are that provider's (the app layer passes --provider).
 * - The model list asks the provider's API, so it is fetched only when the person presses the
 *   button, and the button says so (Y-2). A model is chosen by the entry id the list gave out.
 * - Provider names come from the app layer (DR-22); this file names none.
 * - There is no key field anywhere (C-1, N-10).
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asModels, asProposal, asSelectModel, asSettings, asWritten } from "../api.js";
import type { CodarynApi } from "../api.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";
import type { ProfileView, SettingsRules, SettingsView } from "../../shared/ipc.js";

export interface SettingsDeps {
  readonly texts: Texts;
  readonly api: CodarynApi;
  /** The window's language, as the engine host chose it. */
  readonly language: "ko" | "en";
  readonly announce: (text: string) => void;
}

function errorBox(t: Texts, code: string): HTMLElement {
  const box = el("div", undefined, { role: "alert", class: "error", "data-error": code });
  box.append(el("p", errorText(t, code)), el("p", t.format("error.code", { code }), { class: "code", lang: "en" }));
  return box;
}

function section(id: string, title: string): HTMLElement {
  const box = el("section", undefined, { id, "aria-labelledby": `${id}-title` });
  box.append(el("h3", title, { id: `${id}-title` }));
  return box;
}

function limitText(t: Texts, [key, value]: readonly [string, number | null]): string {
  const id = `limit.${key}`;
  const label = t.has(id) ? t.format(id) : key;
  return `${label}: ${value === null ? t.format("settings.noLimit") : String(value)}`;
}

function profileItem(t: Texts, profile: ProfileView): HTMLElement {
  const item = el("li", undefined, { "data-profile": profile.name });
  item.append(el("h4", profile.name));
  const facts = el("ul", undefined, { class: "facts" });
  facts.append(
    el("li", profile.workflowRef === null ? t.format("settings.profileNoWorkflow") : t.format("settings.profileWorkflow", { workflow: profile.workflowRef })),
    el("li", profile.limits.length === 0 ? t.format("settings.profileNoLimits") : profile.limits.map((pair) => limitText(t, pair)).join(", ")),
    el("li", profile.commands.length === 0 ? t.format("settings.profileNoCommands") : t.format("settings.profileCommands", { commands: profile.commands.join(", ") })),
    el("li", t.format("settings.profileVerifiers", { count: String(profile.verifiers) })),
    el("li", t.format("settings.profileProtected", { count: String(profile.protectedPaths) })),
  );
  item.append(facts);
  return item;
}

/** The limits a config file may set (the main process and the engine host check the same list). */
const LIMIT_KEYS = ["maxModelTurns", "maxToolCalls", "maxTotalTokens", "maxDurationMs", "maxRepairAttempts", "maxSameFailures"] as const;
const MAX_LIMIT = 1_000_000_000;

type Edit = Readonly<Record<string, unknown>>;
type Propose = (edit: Edit) => void;

function limitLabel(t: Texts, key: string): string {
  const id = `limit.${key}`;
  return t.has(id) ? t.format(id) : key;
}

function widenWord(t: Texts, kind: string): string {
  const id = `widen.${kind}`;
  return t.has(id) ? t.format(id) : t.format("widen.other");
}

function labelled(id: string, text: string, control: HTMLElement): HTMLElement {
  const box = el("p", undefined, { class: "field" });
  box.append(el("label", text, { for: id }), control);
  return box;
}

/** A list whose items each have a remove button; a removal names the item's place and its text. */
function removable(t: Texts, items: readonly string[], op: string, propose: Propose, attrs: Readonly<Record<string, string>>, extra?: (index: number) => HTMLElement | null): HTMLElement {
  const out = el("ul", undefined, attrs);
  items.forEach((text, index) => {
    const row = el("li", undefined, { "data-item": String(index) });
    const remove = button(t.format("settings.remove"), () => propose({ op, index, shown: text }), { "data-remove": op });
    remove.setAttribute("aria-label", t.format("settings.removeLabel", { item: text }));
    row.append(el("span", text));
    const more = extra?.(index) ?? null;
    if (more !== null) row.append(more);
    row.append(remove);
    out.append(row);
  });
  return out;
}

function rulesSection(t: Texts, rules: SettingsRules, propose: Propose, warn: (code: string) => void): HTMLElement {
  const box = section("settings-rules", t.format("settings.rules"));
  box.append(el("p", t.format("settings.rulesNote"), { class: "notice" }));
  if (!rules.policySet) box.append(el("p", t.format("settings.policyFirst"), { class: "notice", id: "settings-policy-first" }));

  box.append(el("h4", t.format("settings.limits")));
  const set = new Map(rules.limits);
  const limits = el("ul", undefined, { class: "limits" });
  for (const key of LIMIT_KEYS) {
    const row = el("li", undefined, { "data-limit": key });
    const value = set.get(key);
    row.append(el("span", value === undefined ? t.format("settings.limitDefault", { label: limitLabel(t, key) }) : limitText(t, [key, value ?? null])));
    const input = el("input", undefined, { type: "number", min: "1", max: String(MAX_LIMIT), step: "1", id: `settings-limit-${key}`, "aria-label": t.format("settings.limitInput", { label: limitLabel(t, key) }) });
    const apply = button(t.format("settings.limitSet"), () => {
      const n = Number(input.value);
      if (input.value.trim() === "" || !Number.isSafeInteger(n) || n < 1 || n > MAX_LIMIT) return warn("bad_number");
      propose({ op: "limit", key, value: n });
    }, { "data-limit-set": key });
    row.append(input, apply);
    if (value !== undefined) row.append(button(t.format("settings.limitUnset"), () => propose({ op: "limit", key, value: null }), { "data-limit-unset": key }));
    limits.append(row);
  }
  box.append(limits);

  box.append(el("h4", t.format("settings.commands")));
  box.append(rules.commands.length === 0 ? el("p", t.format("settings.noCommands")) : removable(t, rules.commands, "removeCommand", propose, { id: "settings-commands" }));
  const executable = el("input", undefined, { type: "text", id: "settings-command-exe", maxlength: "200", spellcheck: "false" });
  const args = el("textarea", undefined, { id: "settings-command-args", rows: "3", spellcheck: "false" });
  const extra = el("input", undefined, { type: "checkbox", id: "settings-command-extra" });
  const add = button(t.format("settings.addCommand"), () => {
    const exe = executable.value.trim();
    if (exe === "") return warn("empty_value");
    const fixed = args.value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    propose({ op: "addCommand", executable: exe, argsPrefix: fixed, allowExtraArgs: extra.checked === true });
  }, { id: "settings-command-add" });
  box.append(
    labelled("settings-command-exe", t.format("settings.executable"), executable),
    labelled("settings-command-args", t.format("settings.args"), args),
    labelled("settings-command-extra", t.format("settings.extraArgs"), extra),
    add,
  );

  box.append(el("h4", t.format("settings.protected")));
  box.append(rules.protectedPaths.length === 0 ? el("p", t.format("settings.noProtected")) : removable(t, rules.protectedPaths, "removeProtectedPath", propose, { id: "settings-protected" }));
  const path = el("input", undefined, { type: "text", id: "settings-protected-path", maxlength: "1024", spellcheck: "false" });
  box.append(
    labelled("settings-protected-path", t.format("settings.pathInput"), path),
    button(t.format("settings.addPath"), () => (path.value.trim() === "" ? warn("empty_value") : propose({ op: "addProtectedPath", path: path.value.trim() })), { id: "settings-protected-add" }),
  );
  return box;
}

function secretsSection(t: Texts, rules: SettingsRules, propose: Propose, warn: (code: string) => void): HTMLElement {
  const box = section("settings-secrets", t.format("settings.secrets"));
  box.append(el("p", t.format("settings.secretsNote"), { class: "notice" }));
  const names = rules.secretEnv.map((item) => item.name);
  if (names.length === 0) box.append(el("p", t.format("settings.noSecrets")));
  else {
    box.append(
      removable(t, names, "removeSecretEnv", propose, { id: "settings-secret-names" }, (index) => {
        const item = rules.secretEnv[index];
        return item === undefined ? null : el("span", t.format(item.set ? "settings.secretSet" : "settings.secretUnset"), { class: "state", "data-set": String(item.set) });
      }),
    );
  }
  const name = el("input", undefined, { type: "text", id: "settings-secret-name", maxlength: "64", spellcheck: "false", autocomplete: "off" });
  box.append(
    labelled("settings-secret-name", t.format("settings.secretInput"), name),
    button(
      t.format("settings.addSecret"),
      () => {
        const value = name.value.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value)) return warn("bad_name");
        propose({ op: "addSecretEnv", name: value });
      },
      { id: "settings-secret-add" },
    ),
  );
  return box;
}

/** The provider runs use now: the one the config names, else the CLI's default. */
function providerInUse(view: SettingsView): string | null {
  return view.provider ?? view.defaultProvider;
}

function providerSection(t: Texts, view: SettingsView, propose: Propose | null): HTMLElement {
  const box = section("settings-provider", t.format("settings.provider"));
  const inUse = providerInUse(view);
  box.append(
    el("p", t.format(view.provider === null ? "settings.providerDefault" : "settings.providerChosen", { provider: inUse ?? "-" }), {
      id: "settings-provider-current",
      "data-provider": inUse ?? "none",
    }),
  );
  const list = el("ul", undefined, { class: "providers" });
  for (const provider of view.apiProviders) {
    const row = el("li", undefined, { "data-provider": provider.name, "data-key": provider.keySet ? "set" : "missing" });
    if (provider.name === inUse) row.setAttribute("aria-current", "true");
    row.append(el("h4", provider.name, { lang: "en" }));
    const facts = el("ul", undefined, { class: "facts" });
    facts.append(
      el("li", t.format(provider.keySet ? "settings.providerKeySet" : "settings.providerKeyMissing", { env: provider.keyEnv })),
      el("li", provider.model === null ? t.format("settings.providerNoModel") : t.format("settings.providerModel", { model: provider.model })),
    );
    if (provider.modelEnvSet) facts.append(el("li", t.format("settings.providerModelEnv", { env: provider.modelEnv })));
    // R27-I3: the address variable wins over the config file's address (the value is not shown).
    if (provider.baseUrlEnvSet && provider.baseUrlEnv !== null) facts.append(el("li", t.format("settings.providerBaseUrlEnv", { env: provider.baseUrlEnv }), { "data-base-url-env": provider.baseUrlEnv }));
    if (!provider.listable) facts.append(el("li", t.format("settings.providerNoList", { provider: provider.name }), { "data-no-list": provider.name }));
    row.append(facts);
    list.append(row);
  }
  box.append(list);
  if (propose !== null && view.apiProviders.length > 0) {
    const choice = el("select", undefined, { id: "settings-provider-choice" });
    for (const provider of view.apiProviders) {
      const option = el("option", provider.name, { value: provider.name, lang: "en" });
      if (provider.name === inUse) option.setAttribute("selected", "");
      choice.append(option);
    }
    choice.value = inUse ?? "";
    box.append(
      labelled("settings-provider-choice", t.format("settings.providerChoice"), choice),
      button(t.format("settings.propose"), () => propose({ op: "provider", value: choice.value }), { id: "settings-provider-change" }),
      el("p", t.format("settings.providerNotice"), { class: "notice" }),
    );
  }
  return box;
}

function general(t: Texts, view: SettingsView, language: "ko" | "en", propose?: Propose): HTMLElement {
  const box = section("settings-general", t.format("settings.general"));
  const file = view.file;
  box.append(
    el("p", file === null ? t.format("settings.noFile") : t.format("settings.file", { file: file.display }), { id: "settings-file", "data-source": file?.source ?? "none" }),
  );
  if (file !== null) {
    box.append(el("p", t.format(`settings.source.${file.source}`)));
    if (!file.exists) box.append(el("p", t.format("settings.fileMissing")));
  }
  box.append(el("p", t.format("settings.language", { language: t.format(`language.${language}`) })));
  if (view.env.language) box.append(el("p", t.format("settings.languageEnv")));
  if (propose !== undefined && file !== null && file.exists) {
    const choice = el("select", undefined, { id: "settings-language-choice" });
    for (const [value, label] of [["auto", t.format("settings.languageAuto")], ["ko", "한국어"], ["en", "English"]] as const) {
      const option = el("option", label, { value, lang: value === "auto" ? language : value });
      if (value === (view.language ?? "auto")) option.setAttribute("selected", "");
      choice.append(option);
    }
    choice.value = view.language ?? "auto";
    box.append(
      labelled("settings-language-choice", t.format("settings.languageChoice"), choice),
      button(t.format("settings.propose"), () => propose({ op: "language", value: choice.value === "ko" || choice.value === "en" ? choice.value : null }), { id: "settings-language-change" }),
      el("p", t.format("settings.languageNext"), { class: "notice" }),
    );
  }
  return box;
}

export function settingsScreen(deps: SettingsDeps): Screen {
  const { texts: t, api } = deps;
  let written: string | null = null;
  const screen: Screen = {
    id: "settings",
    title: "nav.settings",
    show(root) {
      const body = el("div", undefined, { id: "settings" });
      root.replaceChildren(el("h2", t.format("settings.title")), body);
      // One proposal at a time: its changed fields, what widens, and "Write" / "Do not write".
      const proposal = el("div", undefined, { id: "settings-proposal", role: "status", "aria-live": "polite" });
      if (written !== null) {
        proposal.append(el("p", written));
        proposal.setAttribute("data-proposal", "written");
        written = null;
      }
      const warn = (code: string): void => {
        proposal.replaceChildren(errorBox(t, code));
        proposal.setAttribute("data-proposal", code);
      };
      const propose: Propose = (edit) => {
        void (async () => {
          proposal.replaceChildren(el("p", t.format("settings.proposing")));
          proposal.setAttribute("data-proposal", "asking");
          const reply = asProposal(await api.proposeSettings(edit));
          if (!reply.ok) return warn(reply.code);
          if (reply.changes.length === 0) {
            proposal.replaceChildren(el("p", t.format("settings.noChange")));
            proposal.setAttribute("data-proposal", "none");
            return;
          }
          const parts: HTMLElement[] = [el("h4", t.format("settings.proposal"))];
          const changes = el("ul", undefined, { class: "changes" });
          for (const change of reply.changes) {
            const id = `settings.change.${change.change}`;
            changes.append(el("li", t.has(id) ? t.format(id, { field: change.field }) : change.field));
          }
          parts.push(changes);
          if (reply.widening.length > 0) {
            parts.push(el("p", t.format("settings.widens"), { class: "notice", "data-widens": String(reply.widening.length) }));
            const widening = el("ul", undefined, { class: "widening" });
            for (const item of reply.widening) widening.append(el("li", `${widenWord(t, item.kind)} (${item.field})`, { "data-kind": item.kind }));
            parts.push(widening);
          }
          const write = button(
            t.format("settings.write"),
            () => {
              void (async () => {
                write.setAttribute("disabled", "");
                const done = asWritten(await api.applySettings(reply.token));
                if (!done.ok) return warn(done.code);
                written = t.format(done.written ? "settings.written" : "settings.noChange");
                deps.announce(written);
                screen.show(root);
              })();
            },
            { id: "settings-write" },
          );
          const keep = button(
            t.format("settings.keep"),
            () => {
              proposal.replaceChildren(el("p", t.format("settings.kept")));
              proposal.setAttribute("data-proposal", "kept");
            },
            { id: "settings-keep" },
          );
          proposal.replaceChildren(...parts, write, keep);
          proposal.setAttribute("data-proposal", reply.widening.length > 0 ? "widens" : "ready");
        })();
      };
      void (async () => {
        const reply = asSettings(await api.settings());
        if (!reply.ok) {
          body.replaceChildren(errorBox(t, reply.code));
          body.setAttribute("data-settings-ready", "error");
          return;
        }
        const view = reply.view;

        const model = section("settings-model", t.format("settings.model"));
        const inUse = providerInUse(view);
        const inUseView = view.apiProviders.find((provider) => provider.name === inUse) ?? null;
        const currentModel = inUseView === null ? view.model : inUseView.model;
        const current = el("p", currentModel === null ? t.format("settings.modelNone") : t.format("settings.modelCurrent", { model: currentModel }), { id: "settings-model-current" });
        model.append(current);
        if (inUseView === null ? view.env.model : inUseView.modelEnvSet) model.append(el("p", inUseView === null ? t.format("settings.modelEnv") : t.format("settings.providerModelEnv", { env: inUseView.modelEnv })));
        const outcome = el("div", undefined, { id: "settings-model-outcome", role: "status" });
        const listed = view.providers;
        if (inUse !== null && !listed.includes(inUse)) model.append(el("p", t.format("settings.providerNoList", { provider: inUse }), { class: "notice", id: "settings-model-no-list" }));
        for (const provider of listed) {
          const list = el("ol", undefined, { class: "models", "data-provider": provider });
          const fetch = button(t.format("settings.listModels", { provider }), () => {
            void (async () => {
              fetch.setAttribute("disabled", "");
              list.replaceChildren(el("li", t.format("settings.listing")));
              outcome.replaceChildren();
              const models = asModels(await api.listModels(provider));
              fetch.removeAttribute("disabled");
              if (!models.ok) {
                list.replaceChildren();
                outcome.replaceChildren(errorBox(t, models.code));
                list.setAttribute("data-models-ready", "error");
                return;
              }
              if (models.models.length === 0) list.replaceChildren(el("li", t.format("settings.modelsEmpty")));
              else {
                list.replaceChildren(
                  ...models.models.map((entry) => {
                    const row = el("li", undefined, { "data-model": entry.id });
                    row.append(el("span", entry.name, { class: "model-name" }), el("span", entry.id, { class: "model-id", lang: "en" }));
                    const use = button(t.format("settings.useModel"), () => {
                      void (async () => {
                        const chosen = asSelectModel(await api.selectModel(entry.entry));
                        if (!chosen.ok) {
                          outcome.replaceChildren(errorBox(t, chosen.code));
                          return;
                        }
                        const lines = [t.format("settings.selected", { model: chosen.selected.id })];
                        if (chosen.selected.created) lines.push(t.format("settings.selectedCreated"));
                        if (chosen.selected.overridden) lines.push(t.format("settings.modelEnv"));
                        outcome.replaceChildren(...lines.map((line) => el("p", line)));
                        outcome.setAttribute("data-selected", chosen.selected.id);
                        // The line names the model of the provider in use; another provider's choice leaves it.
                        if (provider === inUse) current.textContent = t.format("settings.modelCurrent", { model: chosen.selected.id });
                        deps.announce(lines[0] as string);
                      })();
                    });
                    use.setAttribute("aria-label", `${t.format("settings.useModel")}: ${entry.name}`);
                    row.append(use);
                    return row;
                  }),
                );
              }
              if (models.current !== null) {
                outcome.replaceChildren(el("p", t.format(models.current.listed ? "settings.currentListed" : "settings.currentNotListed", { model: models.current.id })));
              }
              list.setAttribute("data-models-ready", String(models.models.length));
            })();
          });
          fetch.setAttribute("data-list-models", provider);
          model.append(el("p", t.format("settings.listNotice", { provider }), { class: "notice" }), fetch, list);
        }
        model.append(outcome);

        const profiles = section("settings-profiles", t.format("settings.profiles"));
        if (view.profiles.length === 0) profiles.append(el("p", t.format("settings.noProfiles")));
        else {
          const profileList = el("ul", undefined, { class: "profiles" });
          profileList.append(...view.profiles.map((profile) => profileItem(t, profile)));
          profiles.append(profileList);
        }
        profiles.append(el("p", t.format("settings.profilesEdit"), { class: "notice" }));

        const workflows = section("settings-workflows", t.format("settings.workflows"));
        const kinds = el("ul", undefined, { class: "workflows" });
        for (const id of view.workflows.builtin) kinds.append(el("li", t.format("settings.workflowBuiltin", { workflow: id }), { "data-workflow": id }));
        for (const id of view.workflows.config) kinds.append(el("li", t.format("settings.workflowConfig", { workflow: id }), { "data-workflow": id }));
        workflows.append(kinds);

        const key = section("settings-key", t.format("settings.key"));
        key.append(el("p", t.format(view.keyAvailable ? "settings.keyAvailable" : "settings.keyMissing"), { "data-key": view.keyAvailable ? "available" : "missing" }));
        key.append(el("p", t.format("settings.keyHow")));

        const editable = view.file !== null && view.file.exists;
        const sections = [general(t, view, deps.language, propose), providerSection(t, view, editable ? propose : null), model, profiles, workflows];
        if (editable) sections.push(rulesSection(t, view.rules, propose, warn), secretsSection(t, view.rules, propose, warn));
        else sections.push(el("p", t.format("settings.createFirst"), { class: "notice", id: "settings-create-first" }));
        body.replaceChildren(proposal, ...sections, key);
        body.setAttribute("data-settings-ready", "ok");
      })();
    },
  };
  return screen;
}
