/**
 * GU-6: the settings screen (docs/design/standalone-gui.md 3.10): where the config file is and who
 * chose it, the model and how to choose one, the profiles (to look at), the task kinds, and
 * whether a key is available. Nothing here edits the config file except choosing a model, which
 * the app layer writes (`selectModel`).
 * - The model list asks the provider's API, so it is fetched only when the person presses the
 *   button, and the button says so (Y-2). A model is chosen by the entry id the list gave out.
 * - Provider names come from the app layer (DR-22); this file names none.
 * - There is no key field anywhere (C-1, N-10).
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asModels, asSelectModel, asSettings } from "../api.js";
import type { CodarynApi } from "../api.js";
import { button, el } from "../shell/dom.js";
import type { Screen } from "../shell/shell.js";
import type { ProfileView, SettingsView } from "../../shared/ipc.js";

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

function general(t: Texts, view: SettingsView, language: "ko" | "en"): HTMLElement {
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
  return box;
}

export function settingsScreen(deps: SettingsDeps): Screen {
  const { texts: t, api } = deps;
  return {
    id: "settings",
    title: "nav.settings",
    show(root) {
      const body = el("div", undefined, { id: "settings" });
      root.replaceChildren(el("h2", t.format("settings.title")), body);
      void (async () => {
        const reply = asSettings(await api.settings());
        if (!reply.ok) {
          body.replaceChildren(errorBox(t, reply.code));
          body.setAttribute("data-settings-ready", "error");
          return;
        }
        const view = reply.view;

        const model = section("settings-model", t.format("settings.model"));
        const current = el("p", view.model === null ? t.format("settings.modelNone") : t.format("settings.modelCurrent", { model: view.model }), { id: "settings-model-current" });
        model.append(current);
        if (view.env.model) model.append(el("p", t.format("settings.modelEnv")));
        const outcome = el("div", undefined, { id: "settings-model-outcome", role: "status" });
        for (const provider of view.providers) {
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
                        current.textContent = t.format("settings.modelCurrent", { model: chosen.selected.id });
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

        body.replaceChildren(general(t, view, deps.language), model, profiles, workflows, key);
        body.setAttribute("data-settings-ready", "ok");
      })();
    },
  };
}
