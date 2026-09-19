# AgentHub Desktop V0.8.9H Completion Report — Legacy Munder Consolidation & Dead-Code Cleanup

## AgentHub Desktop V0.8.9H Completion Report

Base:
be3f0320a619b747a9d948182fa6bee541cc86ff

Production SHA:
e4f4ea4bb3c62aaefbaae80711054c5c177ff8f3

Main head:
e4f4ea4bb3c62aaefbaae80711054c5c177ff8f3

Tag:
V0.8.9H

Tag object:
(annotated tag created following docs commit)

Tag peeled:
e4f4ea4bb3c62aaefbaae80711054c5c177ff8f3

Historical tags:
V0.8.9 unchanged: YES
V0.8.9A unchanged: YES
V0.8.9B unchanged: YES
V0.8.9C unchanged: YES
V0.8.9D unchanged: YES
V0.8.9E unchanged: YES
V0.8.9F unchanged: YES
V0.8.9G unchanged: YES

Backend:
changed: NO

V0.8.9G provenance correction:
Production: 92c25b8d7373b550cc6e9b7c4d76c9a675ab9ab3
Final main/tag peeled: be3f0320a619b747a9d948182fa6bee541cc86ff
Tag object: 28503ee0e57ef82e68c59bd134cd6f158672c992
CI: 35448220859 completed/success

Consolidation:

useHive LOC before:
1105

useHive LOC after:
577

Removed production files:
- src/renderer/src/hooks/useRestoreTeam.ts
- src/renderer/src/hooks/queueDelivery.ts

Removed functions:
- useRestoreTeam
- submitToPty
- waitForTerminalReady
- deliverWithAcknowledgement
- isLegacyTerminalDeliveryResult
- canDeliverToAgent
- checkPrecondition
- enrichTaskPrompt

Removed store fields/actions:
(none deleted to maintain backward migration safety for local persistence; restorableAgents preserved as passive migration data)

Removed UI runtime actions:
- Restore Team button/menu in AgentStrip
- Restore Team banner/controls in FullscreenTerminal

useRestoreTeam retained:
NO

Restore Team UI retained:
NO

Auto restore retained:
NO

Fake local restored/idle mutation retained:
NO

Legacy queue-to-PTY automation retained:
NO

Legal production sent producer count:
0

Production delivery callers:
none

seedPrompt runtime delivery retained:
NO

No-op PTY readiness retained:
NO

writeChains retained for Agent runtime automation:
NO

readyPids retained for Agent runtime automation:
NO

Authority:
spawnPty exposed: NO
writePty exposed: NO
killPty exposed: NO
listPtys exposed: NO
resizePty exposed: NO
provider CLI launch: NO

Dedicated Developer Terminal:
open intent: YES
sender-bound write: YES
sender-bound resize: YES
sender-bound close: YES

Runtime truth:
fake restore: NO
fake restart: NO
fake kill: NO
fake provider switch: NO
fake model switch: NO
fake auto-revive: NO

Office:
Backend snapshot authoritative: YES
legacy roster fallback: NO

Persistence migration:
legacy payload safe: YES
legacy PTY state creates runtime truth: NO

Tests removed:
- test/agenthub-suppressed-delivery-ack-v089f.test.ts
- test/agenthub-explicit-delivery-result-contract-v089g.test.ts

Tests added:
- test/agenthub-legacy-consolidation-v089h.test.ts

Focused:
command: npx tsx --test test/agenthub-legacy-consolidation-v089h.test.ts
timeout: 5000 ms per test
suites: 11
tests: 33
pass: 33
fail: 0
skip: 0
todo: 0

Full:
command: npm run test:agenthub
timeout: 5000 ms per test
suites: 64
tests: 339
pass: 339
fail: 0
skip: 0
todo: 0

Typecheck:
PASS

Build:
PASS

check:links:
PASS

git diff --check:
PASS

GitHub Actions:
run: 35449827390
head: e4f4ea4bb3c62aaefbaae80711054c5c177ff8f3
status: completed
conclusion: success

Production → tag head:
docs-only: YES
changed files:
- docs/LEGACY_MUNDER_CONSOLIDATION_V0.8.9H.md
- docs/AGENTHUB_DESKTOP_V0.8.9H_COMPLETION_REPORT.md

External model/API calls:
0

Final:
PENDING INDEPENDENT AUDIT
