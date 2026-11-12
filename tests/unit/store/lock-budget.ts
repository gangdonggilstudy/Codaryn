/**
 * Z-1 (investigation, section 4): budgets for lock tests that must take the lock or need the
 * system's real answer. Under load the old budgets ran out without any fault:
 * - a wall-clock retry budget of 1-2 s for a reclaim that takes several file operations and retries
 *   (40 ms per file operation already exceeds 1 s in the W-4 case);
 * - the store's 5 s start-time query, when Windows PowerShell alone took up to 5.8 s.
 * Each time the store chose its safe side (the lock kept, or given up with no second holder).
 * acquireLock returns as soon as it takes the lock, and processStartTime as soon as the system
 * answers, so only a broken lock or a broken query ever waits this long.
 */
export const ACQUIRE_BUDGET_MS = 30_000;
export const START_QUERY_BUDGET_MS = 60_000;
