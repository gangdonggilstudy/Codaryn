/**
 * U-293 (the CLI migration's C-6a; PM, on nc-human's condition): queryTableFacts moved word for word
 * to src/app/query-table-facts.ts (only its import's depth changed), where the app layer counts a
 * run's hidden groups for its end summary (src/app/tally.ts). The renderers here and their tests keep
 * this path.
 */

export { queryTableFacts } from "../../app/query-table-facts.js";
export type { QueryTableFacts } from "../../app/query-table-facts.js";
