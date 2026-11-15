/** U-325: fixed scheduling expectations first verified on the adopted U324 archive. Synthetic ports only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { DoctorEnvironment } from "../../../src/cli/doctor.js";

const { runDoctor } = await import(process.env.CODARYN_U325_DOCTOR_MODULE ?? new URL("../../../src/cli/doctor.js", import.meta.url).href) as typeof import("../../../src/cli/doctor.js");
type Scenario = "no-io" | "io" | "refusal" | "parse-refusal" | "argv-throw" | "platform-throw" | "presentation-throw" | "io-presentation-throw";
const scenarios: Scenario[] = ["no-io", "io", "refusal", "parse-refusal", "argv-throw", "platform-throw", "presentation-throw", "io-presentation-throw"];
const expected: Record<Scenario, string[]> = {
  "no-io": ["terminal:false", "returned", "fulfilled", "queued"],
  "io": ["read", "returned", "queued", "terminal:true", "tick1", "fulfilled", "tick2"],
  "refusal": ["returned", "fulfilled", "queued"],
  "parse-refusal": ["returned", "fulfilled", "queued"],
  "argv-throw": ["argv", "returned", "rejected", "queued"],
  "platform-throw": ["platform", "returned", "rejected", "queued"],
  "presentation-throw": ["terminal:false", "returned", "rejected", "queued"],
  "io-presentation-throw": ["read", "returned", "queued", "terminal:true", "tick1", "rejected", "tick2"],
};
for (const scenario of scenarios) {
  test(`U-325 scheduling: ${scenario}`, async (t) => {
    const trace: string[] = [], failure = new Error("synthetic getter failure");
    let terminal = false;
    let release!: (text: string) => void;
    const file = new Promise<string>((resolve) => { release = resolve; });
    const withIo = scenario === "io" || scenario === "io-presentation-throw";
    const io: DoctorEnvironment = {
      argv: ["doctor", ...(withIo ? ["--vars-file", "synthetic.env"] : scenario === "refusal" ? ["--config", "//127.0.0.1/share/c.json"] : scenario === "parse-refusal" ? ["--unknown"] : [])],
      env: {}, cwd: "D:/synthetic-doctor-probe", nodeVersion: "26.0.0", platform: "win32",
      readFile: () => { trace.push("read"); return file; }, isDirectory: async () => true, isFile: async () => false,
      locateInWorkspace: async () => "outside", relatePaths: async () => "separate",
      get stdoutIsTerminal() {
        trace.push(`terminal:${terminal}`);
        if (scenario === "presentation-throw" || scenario === "io-presentation-throw") throw failure;
        return terminal;
      },
    };
    if (scenario === "argv-throw") Object.defineProperty(io, "argv", { get() { trace.push("argv"); throw failure; } });
    if (scenario === "platform-throw") Object.defineProperty(io, "platform", { get() { trace.push("platform"); throw failure; } });
    // runDoctor must always return a Promise, including synchronous parse/port getter exceptions.
    const pending = runDoctor(io);
    assert.ok(pending instanceof Promise);
    trace.push("returned"); terminal = true;
    let result: Awaited<ReturnType<typeof runDoctor>> | undefined, error: unknown;
    const observed = pending.then((value) => { trace.push("fulfilled"); result = value; }, (value: unknown) => { trace.push("rejected"); error = value; });
    queueMicrotask(() => trace.push("queued"));
    if (withIo) {
      release("");
      queueMicrotask(() => { trace.push("tick1"); queueMicrotask(() => trace.push("tick2")); });
    }
    await observed;
    const serialized = JSON.stringify(result);
    t.diagnostic(JSON.stringify({ scenario, trace, textLength: result !== undefined && "text" in result ? result.text.length : null, resultBytes: serialized === undefined ? 0 : Buffer.byteLength(serialized), resultSha256: serialized === undefined ? null : createHash("sha256").update(serialized).digest("hex"), sameThrownObject: error === failure }));
    assert.deepEqual(trace, expected[scenario]);
    if (scenario.endsWith("throw")) assert.strictEqual(error, failure);
    else { assert.equal(error, undefined); assert.ok(result !== undefined); }
    if (scenario === "no-io") { assert.ok(result !== undefined && "text" in result); assert.equal(result.text.length, 1342); }
    if (scenario === "io") { assert.ok(result !== undefined && "text" in result); assert.ok(result.text.includes("1.")); }
    if (scenario === "refusal" || scenario === "parse-refusal") { assert.ok(result !== undefined && "output" in result && result.output.kind === "error"); assert.equal(result.output.code, "invalid_arguments"); }
  });
}
