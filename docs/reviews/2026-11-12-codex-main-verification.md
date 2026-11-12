# Main verification

Persona: verification engineer
Worktree: D:/project/Codaryn/.worktrees/codex-verify
Branch: detached HEAD 3f15a3f30aed956020963e785665c3b582658486 (equal to main when verification started).
Main advanced separately to 052ec1ef59c514acc79af27a54ef88b1efd640b7; the verification checkout was not changed.
Node: v26.13.1
Setup: npm.cmd ci --offline --no-audit --no-fund --logs-dir .codaryn/npm-logs: exit 0.
Typecheck: npm.cmd run typecheck: exit 0.
Scope: unit/mock and process integration tests. No actual API verification, external network or key-file inspection.
Execution: approved execution outside the sandbox.
Preliminary attempts: a sandbox unit run did not exit and was terminated; sandbox process termination limits are a hypothesis, not an established cause. An initial outside-sandbox collection had six exit-0 commands but read nested example counters. A subsequent collector check omitted TODO counts. These collection attempts are excluded below; final counters include TODO separately.
Started UTC: 2026-11-12T06:56:16.067Z

| Round | Suite | tests | pass | fail | skipped | todo | Exit | Duration ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | test:unit | 1525 | 1520 | 0 | 3 | 2 | 0 | 16945 |
| 1 | test:integration | 519 | 519 | 0 | 0 | 0 | 0 | 15888 |
| 2 | test:unit | 1525 | 1520 | 0 | 3 | 2 | 0 | 16948 |
| 2 | test:integration | 519 | 519 | 0 | 0 | 0 | 0 | 16005 |
| 3 | test:unit | 1525 | 1520 | 0 | 3 | 2 | 0 | 17066 |
| 3 | test:integration | 519 | 519 | 0 | 0 | 0 | 0 | 16037 |

Completed suite runs: 6/6
Failed rounds: 0/3

Finished UTC: 2026-11-12T06:57:55.162Z
Final HEAD: 3f15a3f30aed956020963e785665c3b582658486
Main at finish: 052ec1ef59c514acc79af27a54ef88b1efd640b7
Tracked changes: (none)
Failed cases: none
TODO items are reported separately and are not counted as failures.
