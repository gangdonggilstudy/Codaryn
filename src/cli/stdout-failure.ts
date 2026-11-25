/**
 * IR-B5: the one stdout write (main.ts) failed for another reason than a reader that went away
 * (EPIPE). Like the guard's own error (guard.ts), the line is fixed and carries no error text (it may
 * hold a path); it goes to stderr, as stdout cannot take it, and the exit code is 1. A CLI-internal
 * module of its own, so guard.ts keeps its fixed list of names (tests/unit/presentation/json.test.ts).
 */
export const STDOUT_WRITE_FAILED_LINE = "codaryn: stdout_write_failed: the output could not be written to standard output\n";
export const STDOUT_WRITE_FAILED_EXIT_CODE = 1;
