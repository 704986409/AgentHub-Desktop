# AgentHub Desktop V0.8.9I Completion Report

Base:
eac3ff22fb51b4817ef4e60fba0f47180e9f95b6

Production SHA:
796d9bee2bc0e73e10ad2da725e683eb8116a993

Main:
docs-only completion-report commit created after this report

Tag:
V0.8.9I

Tag object:
annotated tag created after the docs-only commit

Tag peeled:
docs-only completion-report commit

Historical tags unchanged:
V0.8.9 YES
V0.8.9A YES
V0.8.9B YES
V0.8.9C YES
V0.8.9D YES
V0.8.9E YES
V0.8.9F YES
V0.8.9G YES
V0.8.9H YES

Backend changed:
NO

Legacy runtime producers before:
6 — Composer, Slack ingress, Realtime ingress, Hive enqueue, terminal handoff, inbox nudge

Legacy runtime producers after:
0

Legacy runtime consumers before:
0

Legacy runtime consumers after:
0

Queue:
messageQueues retained: NO
semantic: removed; legacy persisted payload is safely ignored
runtime delivery: NO
local draft only: NO

Slack:
legacy enqueue retained: NO
false runtime ack retained: NO

Composer:
claims automatic send: NO
Send Now without sender: NO
false message_sent telemetry: NO

Michael:
presentation actor: YES
synthetic ptyId: NO
GOD_PTY retained: NO
runtime status fabricated: NO

Persistence:
legacy Agent becomes live idle: NO
legacy restorable becomes live Agent: NO
legacy queue auto-sends: NO

UI:
Restore list copy: NO
sendingOneByOne without sender: NO
reconnecting without runtime: NO
waking/terminal landing without runtime: NO

Office:
Backend snapshot authoritative: YES
legacy fallback: NO

PTY authority:
spawnPty: NO
writePty: NO
killPty: NO
listPtys: NO
resizePty: NO

Developer Terminal:
openDeveloperTerminal: YES
write sender-bound: YES
resize sender-bound: YES
close sender-bound: YES

Legacy → executeTask auto conversion:
NO

Focused:
command: npx tsx --test test/agenthub-legacy-runtime-final-closure-v089i.test.ts
hard timeout: 30 seconds
timed out: NO
suites: 1
tests: 6
pass: 6
fail: 0
skip: 0
todo: 0

Full:
command: npm run test:agenthub
hard timeout: 30 seconds
timed out: NO
suites: 65
tests: 345
pass: 345
fail: 0
skip: 0
todo: 0

Related legacy/i18n/telemetry regression:
command: node --test test/agent-role.test.cjs test/arabic-ui.test.cjs test/compact-latch.test.cjs test/telemetry-message-count.test.cjs
tests: 40
pass: 40
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

CI:
run: 35452226408
head: 796d9bee2bc0e73e10ad2da725e683eb8116a993
status: completed
conclusion: success

Production → tag head:
docs-only: YES
changed files:
- docs/AGENTHUB_DESKTOP_V0.8.9I_COMPLETION_REPORT.md

External model/API calls:
0

Final:
PENDING INDEPENDENT AUDIT

