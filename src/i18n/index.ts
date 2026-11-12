/**
 * N-4: human-readable messages in Korean and English, and the choice between them
 * (src/contracts/human.ts, docs/cli-contract.md 17.4).
 *
 *   const language = selectMessageLanguage({ env: process.env.CODARYN_LANG ?? null, config: config?.language ?? null, osLocale: runtimeLocale() });
 *   const messages = createMessageCatalog(language);
 *   messages.format("summary.changes", { count: 2 });
 *
 * Error codes, JSON fields, exit codes and command names stay English. A message never holds a
 * value read from a file or the environment: params.ts turns every parameter into a number, a
 * fixed code, a schema field position or a fixed display string, or "?".
 */

export { createMessageCatalog, MESSAGE_TEXTS, MessageFormatError, OWN_TEXT_MEMORY, PLACEHOLDER } from "./catalog.js";
export type { MessageTexts } from "./catalog.js";
export { DEFAULT_MESSAGE_LANGUAGE, localeLanguage, parseMessageLanguage, runtimeLocale, selectMessageLanguage } from "./language.js";
export {
  cleanLine,
  DISPLAY_LOCATIONS,
  formatParam,
  GENERATED_RUN_ID,
  HIDDEN_KEY,
  KNOWN_FIELD_NAMES,
  MESSAGE_CODES,
  REPLACEMENT,
} from "./params.js";
