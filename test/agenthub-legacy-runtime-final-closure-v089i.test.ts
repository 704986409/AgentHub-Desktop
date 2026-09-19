import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function sourceFiles(dir = SRC): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx|json)$/.test(entry.name) ? [full] : [];
  });
}

describe('AgentHub Desktop V0.8.9I — Legacy Runtime Final Closure', { timeout: 5_000 }, () => {
  it('has zero legacy Renderer queue producers and no send composer', () => {
    const forbidden = /\b(?:enqueueMessage|messageQueues|releaseQueuedMessage|removeQueuedMessage|clearQueue|QueuedMessage|MessageQueueComposer)\b/;
    for (const file of sourceFiles()) {
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), forbidden, path.relative(ROOT, file));
    }
    assert.equal(fs.existsSync(path.join(SRC, 'renderer/src/components/MessageQueueComposer.tsx')), false);
  });

  it('does not acknowledge Slack work or convert legacy ingress into execution', () => {
    const hive = read('src/renderer/src/hooks/useHive.ts');
    assert.doesNotMatch(hive, /onSlackMessage|slackReply|onRealtimeEnqueue|onHiveEnqueue|onHiveTerminalHandoff/);
    assert.doesNotMatch(hive, /executeTask/);
    assert.doesNotMatch(hive, /team is on it|will reply when done|queued for execution/i);
  });

  it('models Michael as a presentation actor with no runtime identity', () => {
    const store = read('src/renderer/src/store/store.ts');
    const hive = read('src/renderer/src/hooks/useHive.ts');
    const actorBlock = store.slice(store.indexOf('export interface PresentationActor'), store.indexOf('export interface FeedEntry'));
    const presentationBootstrap = hive.slice(hive.indexOf('// 1) Resolve Michael'), hive.indexOf('// 2) Drive avatars'));
    assert.match(actorBlock, /role:\s*'office-host'/);
    assert.doesNotMatch(actorBlock, /ptyId|provider|model|status|action/);
    assert.doesNotMatch(presentationBootstrap, /GOD_PTY|pty-god|status:\s*'idle'|running the floor/);
  });

  it('routes Michael selection to Command Center without terminal acquisition', () => {
    const app = read('src/renderer/src/App.tsx');
    const commandCenter = read('src/renderer/src/components/CommandCenterPanel.tsx');
    assert.match(app, /selectedId === GOD_ID[\s\S]*CommandCenterPanel actor=\{presentationActor\}/);
    assert.doesNotMatch(commandCenter, /PtyTerminalView|MessageQueueComposer|controlAutoDelivery/);
  });

  it('ignores legacy active, restorable, and queue runtime payloads', () => {
    const store = read('src/renderer/src/store/store.ts');
    assert.match(store, /function loadPersistedAgents\(\): Agent\[\]\s*\{\s*return \[\];\s*\}/);
    assert.match(store, /rosterMirror\.restorable = \[\]/);
    assert.match(store, /rosterMirror\.queues = \{\}/);
    assert.doesNotMatch(store, /loadPersistedRestorable|persistRestorable|restorableAgents/);
    assert.doesNotMatch(store, /action:\s*['"]reconnecting/);
  });

  it('removes false restore, delivery, and boot copy from production', () => {
    const forbidden = /restorable from last session|restore list|sending one by one|send now|WAKING THE FLOOR|terminal will land here|team is on it|will reply here when done/i;
    for (const file of sourceFiles()) {
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), forbidden, path.relative(ROOT, file));
    }
  });
});
