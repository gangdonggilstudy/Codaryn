/**
 * Fake secrets for integration tests. They are deliberately unlike any real key format.
 * Never put real secrets or API keys in fixtures.
 */

export const FAKE_SECRET_ENV_A = "CODARYN_TEST_SECRET";
/** Alphanumeric, so it can also appear in file names. */
export const FAKE_SECRET_A = "cdyFakeCanaryA7Q2xLm9Pz4w";

export const FAKE_SECRET_ENV_B = "CODARYN_TEST_SECRET_B";
/** Contains characters that change under URL encoding and JSON escaping. */
export const FAKE_SECRET_B = 'cdy-fake/B+"q9 canary';

/** Distinctive characters, so any 4-character piece of it is recognisable in outputs. */
export const FRAGMENT_SECRET = "zqv8Kx7Wv2Lp9HnRt4Ym3";

/** Contains a double quote, so its JSON-escaped form differs from the raw value. */
export const JSON_QUOTE_SECRET = 'cdyJson"Q7-canary';

/** Two secrets that overlap: the end of the first ("Rz8") is the start of the second. */
export const OVERLAP_SECRET_FIRST = "ovlpAlphaQm4Rz8";
export const OVERLAP_SECRET_SECOND = "Rz8BetaTn6Wq2";

/**
 * Its Base64 has "+" and "=" padding and its URL encoding has hex letters, so unpadded Base64,
 * base64url and lowercase percent encoding all differ from the listed forms.
 */
export const VARIANT_SECRET = "cdyVar/?>cdycdycdyKx";

/**
 * Fake API keys for mock API tests (local fake server only). They do not have the shape of a
 * real key, so the CLI's key pattern and the commit hook never mistake them for one.
 * `cliEnv({ fakeApiKey })` accepts only these values.
 */
export const FAKE_API_KEY = "cdy-fake-apikey-Xq7Lm2Vt9Rw4";
/** Written only into a temporary file passed with `--vars-file`. */
export const FAKE_API_KEY_ENV_FILE = "cdy-fake-envfile-Hp3Zs8Nk6Dy";
/** Written only into `.env` files that the CLI must never load on its own. */
export const FAKE_API_KEY_DECOY = "cdy-fake-decoy-Bw6Jt1Qc5Gm";
/** S-11: keys must be printable ASCII without spaces. These two are malformed on purpose. */
export const FAKE_API_KEY_SPACE = "cdy-fake apikey-Mb5Tq8Lw";
export const FAKE_API_KEY_NON_ASCII = "cdy-fake-apikey-ü-Wd3Kp9";
/**
 * The second provider (OpenAI, DR-31): set with `cliEnv({ fakeOpenAiKey })`. Not of the loose `sk-`
 * shape (design 4.3), so neither the CLI nor the commit hook takes it for a real key.
 */
export const FAKE_OPENAI_KEY = "cdy-fake-oaikey-Tn4Rw8Kp2Zs6";
/** For an OpenAI run that the fake server answers 401. */
export const FAKE_OPENAI_KEY_REJECTED = "cdy-fake-oaikey-rejected-Hv5Jm3";
/**
 * R-20 E: placeholder values other tools' documents put in OPENAI_API_KEY (vLLM `EMPTY`, Ollama
 * `ollama`, a bare `x`). Shorter than MIN_OTHER_PROVIDER_KEY_LENGTH, so a run of another provider
 * must not register them as secrets (DR-34 (b)).
 */
export const OTHER_KEY_PLACEHOLDERS = ["EMPTY", "ollama", "x"] as const;
export const FAKE_API_KEYS: readonly string[] = [
  FAKE_API_KEY,
  FAKE_API_KEY_ENV_FILE,
  FAKE_API_KEY_DECOY,
  FAKE_API_KEY_SPACE,
  FAKE_API_KEY_NON_ASCII,
  FAKE_OPENAI_KEY,
  FAKE_OPENAI_KEY_REJECTED,
  ...OTHER_KEY_PLACEHOLDERS,
];

/** S-4: a value an env file sets. Eight characters or more, so it is registered as a secret. */
export const FAKE_ENV_FILE_VALUE = "cdyEnvFileValueN4q8Tz";
/** S-4: shorter than eight characters, so it is not registered (and stays readable). */
export const SHORT_ENV_FILE_VALUE = "cdy1234";

/** A variable outside CHILD_ENV_ALLOWLIST that must not reach child processes. */
export const PROBE_ENV = "CODARYN_IT_PROBE";
export const PROBE_VALUE = "cdy-probe-not-allowlisted";
