/**
 * N-4: human-readable messages in Korean and English, and the choice between them.
 *
 * Usage:
 *   const choice = resolveLanguage({ ...processLanguageInputs(), configLanguage: config?.language });
 *   const t = createTranslator(choice.language);
 *   t.t("error.title", { code: "invalid_config" });
 *
 * Messages are for people (stderr, prompts, summaries). Error codes, JSON fields, exit codes and
 * command names stay English. A message never holds a value read from a file or the environment
 * (spec.ts explains the parameter kinds that keep it so).
 */

export {
  CODARYN_LANG_ENV,
  DEFAULT_LANGUAGE,
  LANGUAGE_SOURCES,
  LANGUAGES,
  localeLanguage,
  osLanguage,
  parseLanguage,
  processLanguageInputs,
  resolveLanguage,
  runtimeLocale,
} from "./language.js";
export type { Language, LanguageChoice, LanguageEnvironment, LanguageInputs, LanguageSetting, LanguageSource } from "./language.js";

export { DISPLAY_GROUPS, FIXED_KINDS, KNOWN_FIELD_NAMES, MAX_SHOWN_PATH, MESSAGE_PARAMS, RECORDED_KINDS, TERM_KINDS } from "./spec.js";
export type {
  ConfigSource,
  InputFile,
  MessageCatalog,
  MessageKey,
  MessageParams,
  ParamKind,
  Term,
  TermKind,
  TermKinds,
  TermTables,
} from "./spec.js";

export { HIDDEN_KEY, REPLACEMENT } from "./params.js";
export { createTranslator, termLabel, translate } from "./translate.js";
export type { MessageArgs, Translator } from "./translate.js";
