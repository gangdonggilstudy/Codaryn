# R-110 — board pm/unit-A6 (main bd7f0cc0 + na-core's U-210, with U-207), read by nc-human

- Board: `13bd8a7cdce9410dd60a64d12bf2290dab34b703`. Read: `git diff bd7f0cc0 13bd8a7 -- src` (17 files; the human
  output's part: src/cli/human/output.ts, query-table.ts, run.ts's notePrivateData, the catalogs, the workflows).
- Ran: the board's real CLI (`git archive` to the scratchpad, node_modules junction, `tsc`; removed after), the
  scripted model, temporary folders, `CODARYN_LANG` en and ko. No network, no key.
- Scenario (both languages): `private/people.csv` under `policy.unreadablePaths: ["private"]`, analyze-private, k 5.
  Every cell and key holds the marker `ZQX` (names, regions, teams) and unique numbers. Two region groups are shown
  (7 and 5 rows); teams 2 and 3 have 3 rows each (left out); the score column has numbers in 2 of region B's rows
  (its mean left out, fewCells). The model reads `private/notes.txt` and searches `private` (both refused), searches
  the workspace for `ZQX` (allowed, private lines withheld), asks describe, group by region (count, sum, mean), by team
  (count), by region and team (sum), the whole table's min (not allowed on an unreadable table), then writes
  `public/report.md`.
  Then `report` (text and `--json`), `runs`, `changes`, `review --accept`.
- Variants: `minGroupSize: 6`; analyze on a readable copy of the table; analyze-private without unreadable paths;
  a command rule under analyze-private and under the default task type; the document task type with unreadable paths;
  `doctor --task` on the refused ones.

## Count

| Level | Count |
| --- | --- |
| High | 0 |
| Medium | 1 |
| Low | 3 |
| Info | 6 |

## Medium

### M-1 — a run refused for bundle A's settings says only "has an invalid value"; the reason is in the JSON only

- analyze-private without unreadable paths (en, ko the same):
  `task file — policy.unreadablePaths has an invalid value (values are not shown)`, then invalid_task's general fix.
  The JSON message has the reason (UNREADABLE_PATHS_REQUIRED_TEXT: "must not be empty under the analyze-private task
  type: put the folder of the tables with personal data in it …"). The field was not written at all, so "invalid
  value" points the person at nothing. `codaryn doctor --task` (where the fix line sends them) says the same
  ("the task file has an invalid value at policy.unreadablePaths").
- A command rule beside unreadable paths (default task type): `policy.commands has an invalid value`; the JSON says
  "must be empty while unreadablePaths is set: a command can read any file …". Here doctor does explain
  (`doctor.commands.unreadable_with_commands`). Under analyze-private the same rule is refused as "the workflow allows
  no command" (also JSON only).
- Suggestion: as U-228 did for plan_tool_missing, an error hint (CliErrorOutput.hint) for unreadable_paths_required
  and unreadable_with_commands with a catalog line (na-core passes the hint; the renderer and nb-i18n the words), and
  doctor's task file check names the reason for the empty list.

## Low

### L-1 — the refusal hint says query_table can aggregate the tables also where the task type has no query_table

- `summary.denied_unreadable_hint` (U-207, mine): "… it can still aggregate their tables with query_table." The
  document task type (tools read_file, search_files, write_file) with unreadable paths shows it too (run in both
  languages); its agent has no query_table.
- Suggestion: the clause only when the run's tools include query_table (a context field from na-core, the renderer
  picks the line), or a line without it.

### L-2 — the hidden-groups line ends with a clause that is true for groups only

- `summary.groups_hidden` (U-210's text after R-108 L-2): "Groups of fewer than {k} rows, or values from fewer cells
  than that, were left out of {results} table result(s); the agent got only how many groups were left out." (ko: "…
  에이전트는 뺀 묶음의 개수만 받았습니다.")
- For a value left out (fewCells) the agent got the group, its row count and its other values, with that value null;
  it did not get "only how many groups were left out". In the scenario one of the three counted results (region,
  mean of score in B) had no group left out at all.
- Suggestion: the last clause for both, e.g. "the agent got neither those groups nor those values, only how many
  groups were left out" (nb-i18n's words).

### L-3 — analyze-private's checklist in Korean: mixed in the summary, English in `review` and the GUI

- End summary (ko): items 1 and 2 in English (analyze's items as the built-in records them; the translation is the
  user's open question from U-207), item 3 in Korean (builtinReviewItemText).
- `codaryn review --accept` (ko): all three in English. plan-commands.ts prints the recorded entries; it does not use
  builtinReviewItemText, which was exported for review and the GUI. The GUI does not use it either (gui/src).
- Suggestion: review (na-core) and the GUI (p5u) show entries through builtinReviewItemText; the two analyze items
  wait for the user's answer.

## Info

- I-1 (no value, key, column or path): `ZQX`, the table's numbers, sums and means, `people`, `private`, `notes.txt`
  and the column names found in none of: stderr (progress lines, end summary), the JSON line, `report` (text and
  `--json`), `runs`, `review`, in both languages. `changes` shows `public/report.md`'s own text only.
- I-2 (progress lines): describe → "Table described: its columns and counts"; groups → "Table aggregated by 1
  column(s) (count, sum, mean)", "by 2 column(s) (sum)"; readable whole table → "Table aggregated as a whole (min)".
  Korean: "표 모양 확인: 열과 개수", "표 집계: 묶음 열 1개 (count, sum, mean)", "표 집계: 표 전체 (min)". The decision
  line before each says "aggregate a table — allowed (query_table)".
- I-3 (refusals): "read file — denied (path/unreadable_path)", "search files — denied (path/unreadable_path)"; the end
  summary's "Calls refused at files this task may not read: 2" with its hint, after "Denied calls", both languages.
  The workspace search that withheld the private lines is allowed and not counted (as designed).
- I-4 (hidden groups and fewCells): 3 results counted (team: 2 groups left out; region and team: 6; region: only B's
  mean left out), k 5; with `minGroupSize: 6` the line says 6. analyze on a readable table: no such line.
- I-5 (not the renderer's): the whole table's min on an unreadable table fails as `invalid_table` (op_not_allowed);
  the model-facing hint says "Call query_table with describe set to true to see the table's columns, then query only
  those", which speaks of columns, not of the operations an unreadable table allows (the tool's owner).
- I-6 (report): it tells neither the refusals at unreadable files nor the results that left groups out (only
  "denied: 2"), and its task line says "task type `general`" (the task file's own label) for an analyze-private run
  (report.ts, DR-50 as before).
