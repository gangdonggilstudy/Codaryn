/**
 * The CLI side of the line protocol for adapters outside the process (adapter-contract 6):
 * `--events jsonl` lines on stderr and `--confirm stdio` answers on stdin. `main.ts` and `run.ts`
 * connect it (see the A-3 report for the list).
 */

export { AnswerBook, readAnswers } from "./answers.js";
export type { AnswerInput, AnswerOutcome } from "./answers.js";
export { MAX_ANSWER_LINE_LENGTH, PROTOCOL_SCHEMA_VERSION, confirmLine, eventLine, parseAnswerLine, startedLine } from "./lines.js";
export type { ParsedAnswer } from "./lines.js";
export { QuestionCancelledError, askOverProtocol, createProtocolObserver, protocolJournal } from "./observer.js";
export type { WriteLine } from "./observer.js";
export { takeProtocolOptions } from "./options.js";
export type { ProtocolOptions, TakeProtocolOptionsOutcome } from "./options.js";
