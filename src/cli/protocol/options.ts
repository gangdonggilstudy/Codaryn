/**
 * The two protocol options (adapter-contract 6), taken out of a command line before the command's
 * own parser sees the rest, so `args.ts` needs no change until the CLI owner moves them there.
 *
 *   --events jsonl   run, apply: stderr carries protocol lines only (no human progress lines)
 *   --confirm stdio  run only, needs --events jsonl: permission questions answered on stdin
 *
 * Each at most once. Any other value is refused, as are both options in other commands.
 */

export interface ProtocolOptions {
  readonly events: "jsonl" | null;
  readonly confirm: "stdio" | null;
}

export type TakeProtocolOptionsOutcome =
  | { readonly ok: true; readonly options: ProtocolOptions; readonly rest: readonly string[] }
  | { readonly ok: false; readonly message: string };

const COMMANDS_WITH_EVENTS = ["run", "apply"] as const;

export function takeProtocolOptions(argv: readonly string[]): TakeProtocolOptionsOutcome {
  const [command] = argv;
  const rest: string[] = [];
  let events: "jsonl" | null = null;
  let confirm: "stdio" | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index] as string;
    if (index === 0 || (item !== "--events" && item !== "--confirm")) {
      rest.push(item);
      continue;
    }
    const value = argv[index + 1];
    index += 1;
    if (item === "--events") {
      if (events !== null) return { ok: false, message: "--events is given twice" };
      if (value !== "jsonl") return { ok: false, message: "--events takes jsonl" };
      events = "jsonl";
    } else {
      if (confirm !== null) return { ok: false, message: "--confirm is given twice" };
      if (value !== "stdio") return { ok: false, message: "--confirm takes stdio" };
      confirm = "stdio";
    }
  }
  if ((events !== null || confirm !== null) && !(COMMANDS_WITH_EVENTS as readonly string[]).includes(command ?? "")) {
    return { ok: false, message: "--events and --confirm are options of run and apply only" };
  }
  if (confirm !== null && command !== "run") return { ok: false, message: "--confirm stdio is an option of run only: apply asks nothing" };
  if (confirm !== null && events === null) return { ok: false, message: "--confirm stdio needs --events jsonl: questions are written as event lines" };
  return { ok: true, options: { events, confirm }, rest };
}
