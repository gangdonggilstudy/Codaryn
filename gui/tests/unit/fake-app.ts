/**
 * A fake of the app layer part the engine host calls (HostApp), for unit tests. Every function a
 * test does not give answers with an app error, so a call nobody expected shows as that error.
 */

import type { HostApp } from "../../src/engine-host/host.js";

const unused = async (): Promise<unknown> => ({ ok: false, error: { code: "not_used", message: "not used in this test" } });

export function fakeApp(overrides: Partial<HostApp> = {}): HostApp {
  return {
    doctor: unused,
    readSettings: unused,
    listModels: unused,
    selectModel: unused,
    startRun: unused,
    listRuns: unused,
    revert: unused,
    plan: unused,
    applyPlan: unused,
    review: unused,
    changes: unused,
    report: unused,
    proposeSettingsChange: unused,
    applySettingsChange: unused,
    ...overrides,
  };
}
