/**
 * U-293 (the CLI migration's C-6a): withoutEmptyStateChanged moved word for word to
 * src/app/result-fields.ts, where the app layer's run life takes the engine's result. The CLI's run
 * and its plan commands keep this path.
 */

export { withoutEmptyStateChanged } from "../app/result-fields.js";
