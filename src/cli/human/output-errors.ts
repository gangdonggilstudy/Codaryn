/**
 * The human renderer's errors (IR-26 step 3 O2): an input diagnostic, the hints that take a value,
 * and the `error` method. createErrorOutput reads nothing when it is made: output.ts hands it the
 * catalog it was given, and the words are looked up only when the method is called.
 */

import { API_KEY_ENVS, API_MODEL_ENVS, CLI_ERROR_EXIT_CODES, CLI_ERROR_HINT_DETAIL, CLI_ERROR_HINTS, DETAILED_CLI_ERROR_HINTS, PROVIDER_SETTINGS, toSchemaFieldPath } from "../../contracts/index.js";
import type { CatalogText, CliErrorOutput, HumanOutput, InputDiagnostic, MessageCatalog, SchemaFieldPath } from "../../contracts/index.js";
import { token } from "../../app/input/format.js";
import { DOCTOR_CODES, HUMAN_PREFIX, isCount, isOneOf, lines } from "./output-layout.js";

export function createErrorOutput(catalog: MessageCatalog): Pick<HumanOutput, "error"> {
  function diagnosticText(diagnostic: InputDiagnostic): string | null {
    const file = isOneOf(diagnostic.file, ["config", "task", "script"] as const) ? diagnostic.file : null;
    if (file === null) return null;
    const fileText = catalog.format(`diagnostic.file.${file}`);
    const ownField = typeof diagnostic.field === "string" ? toSchemaFieldPath(diagnostic.field) : null;
    const field: SchemaFieldPath | null = ownField ?? toSchemaFieldPath(file);
    let text: CatalogText | null = null;
    switch (diagnostic.code) {
      case "json_syntax":
        if (isCount(diagnostic.line, 1) && isCount(diagnostic.column, 1)) {
          text = catalog.format("diagnostic.json_syntax", { line: diagnostic.line, column: diagnostic.column });
        }
        break;
      case "unknown_field": {
        // N-23(f): a suggestion belongs to the position it was made for; at the file root it misleads.
        const suggestion = ownField !== null && typeof diagnostic.suggestion === "string" ? toSchemaFieldPath(diagnostic.suggestion) : null;
        if (field !== null) {
          text =
            suggestion === null
              ? catalog.format("diagnostic.unknown_field", { field })
              : catalog.format("diagnostic.unknown_field_suggest", { field, suggestion });
        }
        break;
      }
      case "invalid_value":
        if (field !== null) text = catalog.format("diagnostic.invalid_value", { field });
        break;
      case "missing_field":
        if (field !== null) text = catalog.format("diagnostic.missing_field", { field });
        break;
      case "too_deep":
        text = catalog.format("diagnostic.too_deep");
        break;
    }
    // A dash, not a colon: the diagnostic text often has a colon of its own.
    return text === null ? null : `${fileText} — ${text}`;
  }

  /**
   * U-37 (R-69 M1): the lines of a hint that takes a value (DETAILED_CLI_ERROR_HINTS), from the error's
   * CLI_ERROR_HINT_DETAIL. A detail that is absent or does not fit gives no line (the contract:
   * such a hint's line is left out), and never only part of them.
   */
  function detailedHintLines(output: CliErrorOutput): string[] {
    const hint: unknown = output.hint;
    const detail: unknown = (output as { readonly [CLI_ERROR_HINT_DETAIL]?: unknown })[CLI_ERROR_HINT_DETAIL];
    if (!isOneOf(hint, DETAILED_CLI_ERROR_HINTS) || typeof detail !== "object" || detail === null) return [];
    const { position, field, missing } = detail as { readonly position?: unknown; readonly field?: unknown; readonly missing?: unknown };
    switch (hint) {
      case "unknown_option":
        return isCount(position, 1) ? [`  ${catalog.format("error.hint.unknown_option", { position })}`] : [];
      case "key_field_in_task":
      case "key_field_in_config": {
        const place = typeof field === "string" ? toSchemaFieldPath(field) : null;
        return place === null ? [] : [`  ${catalog.format(`error.hint.${hint}`, { field: place })}`];
      }
      case "provider_settings_missing": {
        const items = missingItems(missing);
        return items === null ? [] : [`  ${catalog.format("error.hint.provider_settings_missing")}`, ...items.map((item) => `    - ${item}`)];
      }
    }
  }

  /**
   * U-37: provider_settings_missing's items, one per setting not set, or null when the list does not
   * fit: not a list, empty, an item that is not one of ProviderSettingMissing's forms, or the
   * settings not in PROVIDER_SETTINGS order, each once.
   */
  function missingItems(missing: unknown): CatalogText[] | null {
    if (!Array.isArray(missing) || missing.length === 0) return null;
    const items: CatalogText[] = [];
    let last = -1;
    for (const entry of missing as readonly unknown[]) {
      if (typeof entry !== "object" || entry === null) return null;
      const { setting, keyEnv, modelEnv, field, placeholder } = entry as Record<string, unknown>;
      const order = isOneOf(setting, PROVIDER_SETTINGS) ? PROVIDER_SETTINGS.indexOf(setting) : -1;
      if (order <= last) return null;
      last = order;
      const place = typeof field === "string" ? toSchemaFieldPath(field) : null;
      if (setting === "key") {
        if (!isOneOf(keyEnv, API_KEY_ENVS)) return null;
        items.push(catalog.format("error.missing.key", { keyEnv }));
      } else if (setting === "model") {
        if (!isOneOf(modelEnv, API_MODEL_ENVS) || place === null || typeof placeholder !== "boolean") return null;
        items.push(catalog.format(placeholder ? "error.missing.model_placeholder" : "error.missing.model", { variable: modelEnv, field: place }));
      } else {
        if (place === null) return null;
        items.push(catalog.format("error.missing.output_limit", { field: place }));
      }
    }
    return items;
  }

  return {
    error(output: CliErrorOutput): string {
      const label = catalog.format("error.label");
      const code = output.code;
      if (!Object.prototype.hasOwnProperty.call(CLI_ERROR_EXIT_CODES, code)) {
        return lines([`${HUMAN_PREFIX}${label} (${token(code)})`]);
      }
      // U-228: run_not_plan for a run whose plan is of another kind (hint plan_kind_differs): the run
      // has a plan, so the line says so and the hint is the fix, in place of run_not_plan's own lines.
      const otherKind = code === "run_not_plan" && output.hint === "plan_kind_differs";
      const what = otherKind ? catalog.format("error.run_not_plan.other_kind") : catalog.format(`error.${code}.what`);
      const out = [`${HUMAN_PREFIX}${label} — ${what} (${code})`];
      const diagnostic = output.diagnostic === undefined ? null : diagnosticText(output.diagnostic);
      if (diagnostic !== null) out.push(`  ${diagnostic}`);
      const fix = otherKind ? catalog.format("error.hint.plan_kind_differs") : catalog.format(`error.${code}.fix`);
      out.push(`  ${catalog.format("error.fix_label")}: ${fix}`);
      // N-D 4: the hints are the renderer's own indented lines, so the CLI finds them and adds none.
      if (DOCTOR_CODES.has(code)) out.push(`  ${catalog.format("error.doctor_hint")}`);
      if (code === "workspace_locked") out.push(`  ${catalog.format("lock.remove_hint")}`);
      // R-12 L-2: the error's own advice (CliErrorOutput.hint), as one more indented line.
      if (isOneOf(output.hint, CLI_ERROR_HINTS)) {
        if (!otherKind) out.push(`  ${catalog.format(`error.hint.${output.hint}`)}`);
      }
      // U-37 (R-69 M1): or a hint that takes a value, from the error's detail.
      else out.push(...detailedHintLines(output));
      return lines(out);
    },
  };
}
