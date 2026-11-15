/**
 * PM (c): in the engine host's loopback-only mode, connections made through node:net (and so
 * node:http, node:https and node:tls) reach this machine's loopback address only; any other is
 * refused before a socket connects or a name is looked up, and counted.
 *
 * Every address here stays on this machine: the "outside" one is 127.0.0.2, in the loopback block
 * (127.0.0.0/8; on Windows routed to the loopback interface), which the guard does not count as
 * this machine. Its port is closed, so without the guard the connection is refused by the system
 * at once. No test here reaches another machine, with or without the guard.
 */

import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { test } from "node:test";
import tls from "node:tls";

import { guardSockets } from "../../src/engine-host/transport.js";

/** A port nobody listens on: taken from the system on 127.0.0.1, then closed. */
async function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}

/** The error code a socket ends with (or "connected"). */
function outcome(socket: net.Socket): Promise<string> {
  return new Promise((resolve) => {
    socket.once("connect", () => {
      socket.destroy();
      resolve("connected");
    });
    socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.name));
  });
}

function requestOutcome(request: http.ClientRequest): Promise<string> {
  return new Promise((resolve) => {
    request.once("response", (response) => {
      response.resume();
      resolve(`status ${response.statusCode}`);
    });
    request.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.name));
    request.end();
  });
}

test("transport (PM c): node:net, node:http and node:tls reach the loopback address only; others are refused and counted", async () => {
  const port = await closedPort();
  const original = net.Socket.prototype.connect;
  const refused: string[] = [];
  const uninstall = guardSockets(net, (host) => refused.push(host));
  try {
    assert.equal(await outcome(net.connect({ host: "127.0.0.2", port })), "CODARYN_TEST_TRANSPORT", "net, options form");
    assert.equal(await outcome(net.connect(port, "127.0.0.2")), "CODARYN_TEST_TRANSPORT", "net, port and host");
    assert.equal(await requestOutcome(http.request({ host: "127.0.0.2", port, path: "/" })), "CODARYN_TEST_TRANSPORT", "http");
    assert.equal(await outcome(tls.connect({ host: "127.0.0.2", port, servername: "example.invalid" })), "CODARYN_TEST_TRANSPORT", "tls");
    assert.equal(await outcome(net.connect({ host: "example.invalid", port })), "CODARYN_TEST_TRANSPORT", "a name is refused before any lookup");
    assert.deepEqual(refused, ["127.0.0.2", "127.0.0.2", "127.0.0.2", "127.0.0.2", "example.invalid"]);
    // This machine: let through; the closed port is refused by the system, not by the guard.
    assert.equal(await outcome(net.connect({ host: "127.0.0.1", port })), "ECONNREFUSED");
    assert.equal(await requestOutcome(http.request({ host: "127.0.0.1", port, path: "/" })), "ECONNREFUSED");
    assert.equal(refused.length, 5, "nothing more was refused");
  } finally {
    uninstall();
  }
  assert.equal(net.Socket.prototype.connect, original, "uninstalling restores the original");
});
