// U-135: a small fake Anthropic Messages API on 127.0.0.1 for the cases that need an API provider
// (a permission question comes only from a config's command rule, and a config's runs use an API
// provider, never the scripted model). It answers POST /v1/messages with the next scripted reply
// (content blocks) as one JSON message, and records every request (method, path, body) for the
// comparison. Used with a fake key and the tests' network fence; nothing else is reached.
// U-167: with `models`, GET /v1/models answers them as one page (`codaryn models`).

import { createServer } from "node:http";

/**
 * Starts the server with `replies` (each a list of content blocks) on a free loopback port; with
 * `models` (API model objects) it lists them too.
 */
export async function startFakeAnthropic(replies, { models } = {}) {
  const requests = [];
  let answered = 0;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: request.method ?? "", path: request.url ?? "", body });
      const send = (status, value) => {
        response.writeHead(status, { "content-type": "application/json", "request-id": `req_fake_${requests.length}` });
        response.end(JSON.stringify(value));
      };
      if (models !== undefined && request.method === "GET" && (request.url ?? "").split("?")[0] === "/v1/models") {
        send(200, { data: models, has_more: false, first_id: models[0]?.id ?? null, last_id: models.at(-1)?.id ?? null });
        return;
      }
      if (request.method !== "POST" || request.url !== "/v1/messages") {
        send(404, { type: "error", error: { type: "not_found_error", message: "not found" } });
        return;
      }
      const content = replies[answered];
      answered += 1;
      if (content === undefined) {
        send(500, { type: "error", error: { type: "api_error", message: "the fake server has no more replies" } });
        return;
      }
      let model = "fake-model";
      try {
        model = JSON.parse(body).model ?? model;
      } catch {
        // The reply names the default model.
      }
      send(200, {
        id: `msg_fake_${answered}`,
        type: "message",
        role: "assistant",
        model,
        content,
        stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 },
      });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
export const text = (value) => ({ type: "text", text: value });
