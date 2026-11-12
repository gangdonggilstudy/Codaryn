# Bundle 6c independent verification

Persona: verification engineer
Worktree: D:/project/Codaryn/.worktrees/codex-verify
Detached HEAD: 39df2baacd13e07880bc64f465a204f54f2e35ae
Node: v26.13.1
Started UTC: 2026-11-12T13:07:45.160Z
Commands executed sequentially. No actual API calls or external network used. No tracked edits or commits; dependency installation and build artifacts only.

| Command | Exit | tests | pass | fail | skipped | todo |
|---|---:|---:|---:|---:|---:|---:|
| npm ci --offline --no-audit --no-fund --logs-dir .codaryn/npm-logs | 0 | N/A | N/A | N/A | N/A | N/A |
| npm run typecheck | 0 | N/A | N/A | N/A | N/A | N/A |
| npm run test:unit (run 1) | 0 | 2077 | 2065 | 0 | 3 | 9 |
| npm run test:integration | 0 | 559 | 559 | 0 | 0 | 0 |
| node scripts/check-secrets.mjs --tracked | 0 | N/A | N/A | N/A | N/A | N/A |
| npm run test:unit (run 2) | 0 | 2077 | 2065 | 0 | 3 | 9 |

npm ci --offline --no-audit --no-fund --logs-dir .codaryn/npm-logs: added 4 packages in 946ms; no registry access

npm run typecheck: duration 879 ms

npm run test:unit (run 1): duration 18859 ms; cancelled 0

npm run test:integration: duration 18894 ms; cancelled 0

node scripts/check-secrets.mjs --tracked: duration 16738 ms; check-secrets: no findings

npm run test:unit (run 2): duration 19531 ms; cancelled 0

## Protected test diff

Command: git -C D:/project/Codaryn diff --stat 23daf6b 39df2ba -- tests/unit/cli/sp0-expected.ts tests/unit/model/anthropic/sp0-golden.ts tests/unit/cli/human/real-catalog.test.ts
Exit: 0
Empty stdout: true
stdout:
```text

```
stderr:
```text

```

## Unit repeat comparison

Exit code and tests/pass/fail/skipped/todo/cancelled equal: true
Failed case names equal: true
Observation limited to these two runs; matching results do not establish absence of intermittent failures.

Final HEAD: 39df2baacd13e07880bc64f465a204f54f2e35ae
Tracked status exit: 0
Tracked changes: (none)
Finished UTC: 2026-11-12T13:09:00.308Z
