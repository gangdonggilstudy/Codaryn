/**
 * Model list and choice for the GUI's wizard and settings (standalone-gui 5.2, Y-1 to Y-4).
 *
 * The work is the CLI's `models` command (`runModels`), which app.ts calls as `main.ts` does: the
 * same config file rules (`--config`, CODARYN_CONFIG, the N-1 default location), the same key
 * rules (ANTHROPIC_API_KEY or the variables file, never a file), the same atomic config write for
 * the choice. The app layer never asks at a terminal.
 *
 * - Listing makes a real API request. Call it only when a person asked for the list; never at
 *   start-up or before a run (Y-2).
 * - The request names its provider (DR-22, SP-6): one of the API providers, passed as
 *   `--provider`, so the CLI uses that provider's key, address and lister, and `selectModel` writes
 *   that provider's model, whatever provider the config file names. Another name is refused here,
 *   before anything is read.
 */

import { API_PROVIDER_NAMES } from "../contracts/index.js";
import { appError } from "./errors.js";
import type { AppError, ListModelsRequest, SelectModelRequest } from "./types.js";

/** The providers whose models the app layer lists and selects: the API providers (SP-6). */
export const CONNECTED_MODEL_PROVIDERS = API_PROVIDER_NAMES;

/** The `codaryn models` arguments for a request, or the reason it is refused before anything is read. */
export function modelsArguments(request: ListModelsRequest | SelectModelRequest): { readonly ok: true; readonly argv: string[] } | { readonly ok: false; readonly error: AppError } {
  if (!(CONNECTED_MODEL_PROVIDERS as readonly string[]).includes(request.provider)) {
    return { ok: false, error: appError("invalid_arguments", `the provider must be one of ${CONNECTED_MODEL_PROVIDERS.join(", ")}`) };
  }
  const argv = ["models", "--provider", request.provider];
  if (request.configPath !== null) argv.push("--config", request.configPath);
  if (request.varsFile !== null) argv.push("--vars-file", request.varsFile);
  argv.push("--json");
  if ("model" in request) {
    if (request.model.length === 0 || request.model.startsWith("--")) {
      return { ok: false, error: appError("invalid_arguments", "the model must be an id from the list") };
    }
    argv.push("--use", request.model);
  }
  return { ok: true, argv };
}
