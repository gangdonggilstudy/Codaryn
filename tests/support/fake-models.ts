/**
 * `GET /v1/models` and `GET /v1/models/{id}` for the local fake server (Y-1, Y-5).
 * 모의 API 검증 전용이며 실제 API 검증이 아니다.
 *
 * Shapes, as confirmed from the claude-api skill (shared/models.md, managed-agents-api-reference.md):
 * - headers `x-api-key` and `anthropic-version`, as for Messages requests
 * - a model object has `id`, `display_name`, `max_input_tokens` (input limit), `max_tokens`
 *   (output limit) and `capabilities` (a nested tree with `supported` at each leaf)
 * - the list pages with `limit`, `after_id`, `before_id` and answers `data`, `has_more`,
 *   `first_id`, `last_id`
 * Not confirmed there (미확인, see the Y report): a `type: "model"` field, `created_at`, the
 * default and largest `limit`, and the exact error for an unknown cursor. The fake adds `type` and
 * `created_at` unless a model is built with `omitUnconfirmed`, so a client can be shown to work
 * without them. Its page size is small on purpose, so a client must follow `has_more`.
 */

export const MODELS_PATH = "/v1/models";

export interface FakeModel {
  readonly id: string;
  readonly display_name: string;
  readonly max_input_tokens: number;
  readonly max_tokens: number;
  readonly capabilities: Readonly<Record<string, unknown>>;
  /** Unconfirmed field (미확인). */
  readonly type?: "model";
  /** Unconfirmed field (미확인). RFC 3339 time. */
  readonly created_at?: string;
}

export interface FakeModelOptions {
  /** Leave out `type` and `created_at`. */
  readonly omitUnconfirmed?: boolean;
  readonly createdAt?: string;
}

export function fakeModel(
  id: string,
  displayName: string,
  maxInputTokens: number,
  maxOutputTokens: number,
  options: FakeModelOptions = {},
): FakeModel {
  const model: FakeModel = {
    id,
    display_name: displayName,
    max_input_tokens: maxInputTokens,
    max_tokens: maxOutputTokens,
    capabilities: { image_input: { supported: false }, structured_outputs: { supported: true } },
  };
  if (options.omitUnconfirmed === true) return model;
  return { type: "model", created_at: options.createdAt ?? "2026-01-01T00:00:00Z", ...model };
}

export interface FakeModelsCatalog {
  /** In list order (the API lists newer models first; the fake keeps the order given). */
  readonly models: readonly FakeModel[];
  /** Most models per page, whatever `limit` asks for. Defaults to 2. */
  readonly pageSize?: number;
  /** Answer every models request with this error instead (for example 401). */
  readonly failWith?: { readonly status: number; readonly errorType: string };
}

export interface ModelsAnswer {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

const QUERY_NAMES = new Set(["limit", "after_id", "before_id"]);

/** Protocol problems of one models request. Messages name fields only, never values. */
export function modelsViolations(method: string, url: string, headers: Readonly<Record<string, string>>, bodyText: string): string[] {
  const out: string[] = [];
  if (method !== "GET") out.push("method is not GET");
  const parsed = new URL(url, "http://127.0.0.1");
  const rest = parsed.pathname.slice(MODELS_PATH.length);
  if (!parsed.pathname.startsWith(MODELS_PATH) || (rest !== "" && !/^\/[^/]+$/.test(rest))) {
    out.push(`path is not ${MODELS_PATH} or ${MODELS_PATH}/{id}`);
  }
  if ((headers["x-api-key"] ?? "") === "") out.push("x-api-key header is missing");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(headers["anthropic-version"] ?? "")) out.push("anthropic-version header is missing or not a date");
  if (bodyText !== "") out.push("a GET request has a body");
  for (const name of parsed.searchParams.keys()) {
    if (!QUERY_NAMES.has(name)) out.push(`unknown query parameter ${name}`);
  }
  const limit = parsed.searchParams.get("limit");
  if (limit !== null && !/^[1-9][0-9]{0,3}$/.test(limit)) out.push("limit is not an integer from 1 to 1000");
  if (parsed.searchParams.has("after_id") && parsed.searchParams.has("before_id")) out.push("after_id and before_id together");
  return out;
}

function errorBody(errorType: string, message: string): Readonly<Record<string, unknown>> {
  return { type: "error", error: { type: errorType, message } };
}

/** The answer to a models request that passed `modelsViolations`. */
export function answerModels(url: string, catalog: FakeModelsCatalog): ModelsAnswer {
  if (catalog.failWith !== undefined) {
    return { status: catalog.failWith.status, body: errorBody(catalog.failWith.errorType, "fake models error") };
  }
  const parsed = new URL(url, "http://127.0.0.1");
  const rest = parsed.pathname.slice(MODELS_PATH.length);
  if (rest !== "") {
    const id = decodeURIComponent(rest.slice(1));
    const model = catalog.models.find((item) => item.id === id);
    return model === undefined
      ? { status: 404, body: errorBody("not_found_error", "fake: no such model") }
      : { status: 200, body: { ...model } };
  }

  const ids = catalog.models.map((model) => model.id);
  const after = parsed.searchParams.get("after_id");
  const before = parsed.searchParams.get("before_id");
  const cursor = after ?? before;
  if (cursor !== null && !ids.includes(cursor)) {
    return { status: 400, body: errorBody("invalid_request_error", "fake: unknown cursor") };
  }
  const size = Math.min(Number(parsed.searchParams.get("limit") ?? "20"), catalog.pageSize ?? 2);
  let start: number;
  let end: number;
  if (before !== null) {
    end = ids.indexOf(before);
    start = Math.max(0, end - size);
  } else {
    start = after === null ? 0 : ids.indexOf(after) + 1;
    end = Math.min(ids.length, start + size);
  }
  const page = catalog.models.slice(start, end);
  const hasMore = before !== null ? start > 0 : end < ids.length;
  return {
    status: 200,
    body: {
      data: page,
      has_more: hasMore,
      first_id: page[0]?.id ?? null,
      last_id: page[page.length - 1]?.id ?? null,
    },
  };
}

export function isModelsPath(url: string): boolean {
  const pathname = new URL(url, "http://127.0.0.1").pathname;
  return pathname === MODELS_PATH || pathname.startsWith(`${MODELS_PATH}/`);
}
