/**
 * DR-40 (R-25): checking a file or an argument for key material before it can leave the machine
 * (S-6 task and config files, S-8 `--goal`). Pure functions with no platform module (the GUI imports
 * the contracts too). The refusal shapes are defined in config.ts (API_KEY_PATTERN_SOURCES); these
 * functions give the same answers in time linear in the text's length.
 */

import { OPENAI_LEGACY_KEY_PATTERN_SOURCE, OPENAI_PREFIXED_KEY_PATTERN_SOURCE } from "./config.js";

/**
 * The run ANTHROPIC_KEY_REFUSAL_PATTERN_SOURCE needs: the prefix at a word start and 32 or more key
 * characters, matched once each (global, greedy); whether the run holds a digit is checked in code.
 */
const ANTHROPIC_REFUSAL_RUN = /\bsk-ant-([A-Za-z0-9_-]{32,})/g;
const DIGIT = /[0-9]/;
const OPENAI_PREFIXED = new RegExp(OPENAI_PREFIXED_KEY_PATTERN_SOURCE);
const OPENAI_LEGACY = new RegExp(OPENAI_LEGACY_KEY_PATTERN_SOURCE);

/**
 * DR-40 (c), R-25 L-2: whether `text` matches ANTHROPIC_KEY_REFUSAL_PATTERN_SOURCE, in linear time.
 * That source's look-ahead rescans the run after every word-start prefix, so as a regular
 * expression it takes time growing with the square of the length (seconds for 256 KiB). Here each
 * maximal run is found once and searched for a digit once. Same answers: a later prefix inside a
 * run has the tail of that run, so it holds a digit only when the whole run does.
 */
export function anthropicRefusalShapeIn(text: string): boolean {
  for (const match of text.matchAll(ANTHROPIC_REFUSAL_RUN)) {
    if (DIGIT.test(match[1] as string)) return true;
  }
  return false;
}

/**
 * DR-40: whether `text` holds a refusal key shape (API_KEY_PATTERN_SOURCES), in linear time. Use this,
 * not a regular expression joined from the sources.
 */
export function holdsRefusedKeyShape(text: string): boolean {
  return anthropicRefusalShapeIn(text) || OPENAI_PREFIXED.test(text) || OPENAI_LEGACY.test(text);
}

/**
 * DR-40: the S-6 and S-8 check: a registered key value or a refusal key shape. `values` are the key
 * values the caller registers by the S-2 rules (the run's own key from 16 characters, another
 * provider's from MIN_OTHER_PROVIDER_KEY_LENGTH); empty ones are ignored.
 */
export function createKeyRefusalCheck(values: readonly string[]): (text: string) => boolean {
  const keys = values.filter((value) => value.length > 0);
  return (text: string): boolean => keys.some((value) => text.includes(value)) || holdsRefusedKeyShape(text);
}
