/**
 * N-4: the language of human-readable messages.
 *
 * Order: CODARYN_LANG → the config file's `language` → the operating system's display language
 * (Korean → ko, anything else → en). Error codes, JSON fields, exit codes and command names stay
 * English whatever the language.
 *
 * The values read here only choose the language. None of them is kept or put into a message:
 * a value that is not ko or en is reported by the name of its setting alone.
 */

export const LANGUAGES = ["ko", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Used when nothing tells the language. */
export const DEFAULT_LANGUAGE: Language = "en";

/**
 * Environment variable that sets the language. Temporary home until the N-A contract names it
 * next to the other variables in `src/contracts/config.ts`.
 */
export const CODARYN_LANG_ENV = "CODARYN_LANG";

/**
 * Where the chosen language came from.
 * - CODARYN_LANG, config: that setting held ko or en.
 * - os: the operating system's language, read from the locale.
 * - default: no locale could be read, so DEFAULT_LANGUAGE.
 */
export const LANGUAGE_SOURCES = ["CODARYN_LANG", "config", "os", "default"] as const;
export type LanguageSource = (typeof LANGUAGE_SOURCES)[number];

/** A setting that can name the language explicitly. */
export type LanguageSetting = Extract<LanguageSource, "CODARYN_LANG" | "config">;

export type LanguageEnvironment = Readonly<Record<string, string | undefined>>;

export interface LanguageInputs {
  readonly env: LanguageEnvironment;
  /**
   * The config file's `language` as read, or undefined when there is no config file or no such
   * field. Validating the field is the config reader's job; anything other than ko or en is
   * skipped here and listed in `ignored`.
   */
  readonly configLanguage?: unknown;
  /** `process.platform`. */
  readonly platform: string;
  /** The runtime's default locale (`Intl.DateTimeFormat().resolvedOptions().locale`), or null. */
  readonly intlLocale: string | null;
}

export interface LanguageChoice {
  readonly language: Language;
  readonly source: LanguageSource;
  /** Settings that were set but held neither ko nor en, in precedence order. They were skipped. */
  readonly ignored: readonly LanguageSetting[];
}

/** "ko" or "en", ignoring case and surrounding white space; null for anything else. */
export function parseLanguage(value: unknown): Language | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "ko" || normalized === "en" ? normalized : null;
}

/** Whether a setting counts as set: a non-blank string, or any other value that is present. */
function isSet(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.trim().length > 0;
}

/**
 * The language subtag of a POSIX locale (`ko_KR.UTF-8`, `ko@euro`) or a BCP 47 tag (`ko-KR`),
 * lowercased, or null when there is none.
 */
export function localeLanguage(locale: string | null | undefined): string | null {
  if (typeof locale !== "string") return null;
  const head = locale.trim().split(/[-_.@]/, 1)[0]?.toLowerCase() ?? "";
  return /^[a-z]{2,8}$/.test(head) ? head : null;
}

function fromSubtag(subtag: string): Language {
  return subtag === "ko" ? "ko" : "en";
}

/** The first non-blank value among the names, trimmed. */
function firstSet(env: LanguageEnvironment, names: readonly string[]): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value !== undefined && value.length > 0) return value;
  }
  return null;
}

/**
 * The operating system's display language, or null when no locale can be read.
 *
 * - Windows: the runtime's default locale. ICU takes it from the user's Windows settings and
 *   ignores LANG and LC_* there, as does this function (a POSIX shell on Windows may set them).
 * - Elsewhere, as gettext does for messages: the locale is LC_ALL, else LC_MESSAGES, else LANG.
 *   "C" or "POSIX" means en. Otherwise LANGUAGE, a colon-separated preference list, is read
 *   first, and its first ko or en entry wins. With none of them set, the runtime's default
 *   locale is used.
 */
export function osLanguage(inputs: Pick<LanguageInputs, "env" | "platform" | "intlLocale">): Language | null {
  const fromIntl = (): Language | null => {
    const subtag = localeLanguage(inputs.intlLocale);
    return subtag === null || subtag === "und" ? null : fromSubtag(subtag);
  };
  if (inputs.platform === "win32") return fromIntl();

  const locale = firstSet(inputs.env, ["LC_ALL", "LC_MESSAGES", "LANG"]);
  if (locale === null) return fromIntl();
  const base = locale.split(".", 1)[0] ?? "";
  if (base === "C" || base === "POSIX") return "en";

  const preferences = inputs.env.LANGUAGE?.split(":") ?? [];
  for (const entry of preferences) {
    const subtag = localeLanguage(entry);
    if (subtag === "ko" || subtag === "en") return subtag;
  }
  const subtag = localeLanguage(locale);
  return subtag === null ? null : fromSubtag(subtag);
}

/** Applies the order CODARYN_LANG → config `language` → operating system → DEFAULT_LANGUAGE. */
export function resolveLanguage(inputs: LanguageInputs): LanguageChoice {
  const ignored: LanguageSetting[] = [];

  const envRaw = inputs.env[CODARYN_LANG_ENV];
  const fromEnv = parseLanguage(envRaw);
  if (fromEnv !== null) return { language: fromEnv, source: "CODARYN_LANG", ignored };
  if (isSet(envRaw)) ignored.push("CODARYN_LANG");

  const fromConfig = parseLanguage(inputs.configLanguage);
  if (fromConfig !== null) return { language: fromConfig, source: "config", ignored };
  if (isSet(inputs.configLanguage)) ignored.push("config");

  const fromOs = osLanguage(inputs);
  if (fromOs !== null) return { language: fromOs, source: "os", ignored };
  return { language: DEFAULT_LANGUAGE, source: "default", ignored };
}

/** The runtime's default locale, or null when it cannot be read. */
export function runtimeLocale(): string | null {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    return typeof locale === "string" && locale.length > 0 ? locale : null;
  } catch {
    return null;
  }
}

/** The inputs of this process, except the config file's `language`, which the caller adds. */
export function processLanguageInputs(env: LanguageEnvironment = process.env): Omit<LanguageInputs, "configLanguage"> {
  return { env, platform: process.platform, intlLocale: runtimeLocale() };
}
