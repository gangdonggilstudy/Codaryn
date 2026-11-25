/**
 * U-143 (SP-U05, design gap survey C-7): the OpenAI path through the real CLI and the real fetch,
 * where the unit tests use a fake one. Every address is on 127.0.0.1 and every run is behind the
 * network guard; nothing leaves the machine. Mock API verification only, not the real API.
 * - `run` with a 401: failed/model_error, recorded `auth_failed`, one request (not retried), and a
 *   fixed phrase: no part of the key the provider's message echoes is in any output or record.
 * - A 302 from the API address: the real fetch (`redirect: "manual"`) gives an opaque redirect, which
 *   the transport refuses; the Location server is never asked, and the key goes nowhere else.
 * - An owned loopback TCP listener resets each connection. The listener keeps its port for the
 *   whole run; ECONNRESET is retried and told by its fixed code, without assuming that a released
 *   ephemeral port stays unused. Mock transport failure only, not an API response.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import type { AddressInfo, Socket } from "node:net";
import { test } from "node:test";
import { CODARYN_OPENAI_API_BASE_URL_ENV } from "../../src/contracts/index.js";
import type { JournalRecord } from "../../src/contracts/index.js";
import { createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import { writeOpenAITask } from "../fixtures/openai.js";
import { FAKE_OPENAI_KEY } from "../fixtures/secrets.js";
import { cliEnv, expectRunResult, readRunFiles } from "../support/cli.js";
import { MOCK_LABEL, cliOutputSources, runGuarded } from "../support/fake-anthropic.js";
import { replyOpenAIError, responsesRequests, startFakeOpenAI } from "../support/fake-openai.js";
import { findLeaks } from "../support/leak.js";

const SEED = "seed.txt";
const SEED_RULE = { id: "seed", kind: "file_rules" as const, rules: [{ type: "exists" as const, path: SEED }] };
/** Own the port until the test ends, and fail each real connection with a controlled TCP reset. */
async function resetServer(t: Parameters<typeof createSandbox>[0]) {
  const sockets = new Set<Socket>();
  let connections = 0;
  const tcp = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.once("close", () => sockets.delete(socket));
    connections += 1;
    socket.resetAndDestroy();
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    if (tcp.listening) await new Promise<void>((resolve, reject) => tcp.close((error) => error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    tcp.once("error", reject);
    tcp.listen(0, "127.0.0.1", () => { tcp.off("error", reject); resolve(); });
  });
  return { port: (tcp.address() as AddressInfo).port, connections: () => connections };
}

async function openAIRun(t: Parameters<typeof createSandbox>[0], baseUrl: string) {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, SEED, "seed\n");
  const run = await runGuarded(
    sb,
    ["run", "--task", writeOpenAITask(sb, { id: "o06-transport", verifiers: [SEED_RULE] })],
    cliEnv({ fakeOpenAiKey: FAKE_OPENAI_KEY, extra: { [CODARYN_OPENAI_API_BASE_URL_ENV]: baseUrl } }),
  );
  const result = expectRunResult(run, "openai");
  const records = readRunFiles(sb.workspace, result).records;
  const errors = records.filter((record): record is Extract<JournalRecord, { type: "model_error" }> => record.type === "model_error");
  assert.deepEqual(findLeaks(cliOutputSources(sb.workspace, run), [FAKE_OPENAI_KEY]), [], "the key is in no output or record");
  return { sb, run, result, errors };
}

/** A plain HTTP server on 127.0.0.1 that counts its requests and answers each with `reply`. */
async function server(t: Parameters<typeof createSandbox>[0], reply: (response: import("node:http").ServerResponse) => void) {
  const seen: { method: string; url: string; authorization: string | undefined }[] = [];
  const http = createServer((request, response) => {
    seen.push({ method: request.method ?? "", url: request.url ?? "", authorization: request.headers.authorization });
    request.resume();
    reply(response);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => http.close(() => resolve())));
  return { url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`, seen };
}

test(`${MOCK_LABEL} U-143 SP-U05 run 401: failed/model_error auth_failed, one request, a fixed phrase without the key's echo`, { timeout: 90_000 }, async (t) => {
  const echo = `Incorrect API key provided: ${FAKE_OPENAI_KEY.slice(0, 10)}${"*".repeat(20)}${FAKE_OPENAI_KEY.slice(-4)}.`;
  const api = await startFakeOpenAI(t, [replyOpenAIError(401, "invalid_request_error", "invalid_api_key", { message: echo })]);
  const { run, result, errors } = await openAIRun(t, api.baseUrl);
  assert.deepEqual([result.status, result.reason, run.exitCode], ["failed", "model_error", 1]);
  assert.deepEqual(errors.map((record) => record.kind), ["auth_failed"]);
  assert.equal(responsesRequests(api).length, 1, "auth_failed is not retried");
  assert.match(errors[0]?.message ?? "", /^HTTP 401: the key or its access was refused; the provider's message is not shown/);
  assert.equal(`${run.stdout}${run.stderr}`.includes(FAKE_OPENAI_KEY.slice(-4)), false, "no end of the key in stdout or stderr");
  assert.equal(result.modelError?.retryable, false);
});

test(`${MOCK_LABEL} U-143 SP-U05 a 302 from the API address: refused through the real fetch, its Location is never asked`, { timeout: 90_000 }, async (t) => {
  const elsewhere = await server(t, (response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  const redirecting = await server(t, (response) => {
    response.writeHead(302, { location: `${elsewhere.url}/v1/responses` });
    response.end();
  });
  const { run, result, errors } = await openAIRun(t, `${redirecting.url}/v1`);
  assert.deepEqual([result.status, result.reason, run.exitCode], ["failed", "model_error", 1]);
  assert.deepEqual(errors.map((record) => record.kind), ["api_error"]);
  assert.match(errors[0]?.message ?? "", /redirects are not followed, so the key is not sent elsewhere/);
  assert.equal(redirecting.seen.length, 1, "one attempt: a refused redirect is not retried");
  assert.deepEqual(redirecting.seen.map((one) => [one.method, one.url]), [["POST", "/v1/responses"]]);
  assert.equal(elsewhere.seen.length, 0, "the Location is never asked, so the key is sent nowhere else");
});

test(`${MOCK_LABEL} U-143 SP-U05 an owned reset server: the connection error is retried and told by its code`, { timeout: 120_000 }, async (t) => {
  const api = await resetServer(t);
  const { run, result, errors } = await openAIRun(t, `http://127.0.0.1:${api.port}/v1`);
  assert.deepEqual([result.status, result.reason, run.exitCode], ["failed", "model_error", 1]);
  assert.deepEqual(errors.map((record) => record.kind), ["api_error"]);
  assert.match(errors[0]?.message ?? "", /^network error: connection failed \(ECONNRESET\) \(after \d+ attempts\)$/);
  assert.equal(result.modelError?.retryable, true);
  assert.ok(api.connections() >= 2, "the owned server observed repeated connection attempts");
  t.diagnostic(JSON.stringify({ connections: api.connections(), kind: errors[0]?.kind, message: errors[0]?.message, retryable: result.modelError?.retryable }));
});
