import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  closedAgentHubPanel,
  reduceAgentHubPanel,
  type AgentHubDialogKind,
  type AgentHubPanelState
} from '../src/renderer/src/components/agentHubPanel';

const dialogs: AgentHubDialogKind[] = [
  'submit-task',
  'create-project',
  'agents',
  'lifecycle',
  'execute-task',
  'reviews'
];

describe('AgentHub panel behavior', () => {
  test('P-01 a single toggle stays open', () => {
    const opened = reduceAgentHubPanel(closedAgentHubPanel, { type: 'toggle' });
    assert.equal(reduceAgentHubPanel(opened, { type: 'tick' }).open, true);
  });

  test('P-02 an inside click does not close the panel', () => {
    const opened = reduceAgentHubPanel(closedAgentHubPanel, { type: 'toggle' });
    assert.equal(reduceAgentHubPanel(opened, { type: 'inside' }).open, true);
  });

  test('P-03 the second trigger click closes the panel', () => {
    const opened = reduceAgentHubPanel(closedAgentHubPanel, { type: 'toggle' });
    assert.equal(reduceAgentHubPanel(opened, { type: 'toggle' }).open, false);
  });

  test('P-04 an outside click closes the panel', () => {
    const opened = reduceAgentHubPanel(closedAgentHubPanel, { type: 'toggle' });
    assert.equal(reduceAgentHubPanel(opened, { type: 'outside' }).open, false);
  });

  test('P-05 escape closes the panel when no dialog is open', () => {
    const opened = reduceAgentHubPanel(closedAgentHubPanel, { type: 'toggle' });
    assert.equal(reduceAgentHubPanel(opened, { type: 'escape' }).open, false);
  });

  test('P-06 and M-03 every child action closes the panel and opens that child', () => {
    for (const dialog of dialogs) {
      const opened = reduceAgentHubPanel(closedAgentHubPanel, { type: 'toggle' });
      const next = reduceAgentHubPanel(opened, { type: 'open-dialog', dialog });
      assert.equal(next.open, false, dialog);
      assert.equal(next.dialog, dialog);
    }
  });

  test('P-07 closing a child does not reopen the panel', () => {
    const opened = reduceAgentHubPanel(closedAgentHubPanel, { type: 'toggle' });
    const creating = reduceAgentHubPanel(opened, { type: 'open-dialog', dialog: 'create-project' });
    const closed = reduceAgentHubPanel(creating, { type: 'close-dialog' });
    assert.deepEqual(closed, { open: false, dialog: null });
  });

  test('P-08 twenty toggles stay deterministic', () => {
    let state: AgentHubPanelState = closedAgentHubPanel;
    for (let i = 0; i < 20; i += 1) state = reduceAgentHubPanel(state, { type: 'toggle' });
    assert.equal(state.open, false);
    assert.equal(state.dialog, null);
  });

  test('escape closes the dialog before the panel', () => {
    const creating = reduceAgentHubPanel(
      reduceAgentHubPanel(closedAgentHubPanel, { type: 'toggle' }),
      { type: 'open-dialog', dialog: 'agents' }
    );
    const next = reduceAgentHubPanel(creating, { type: 'escape' });
    assert.deepEqual(next, { open: false, dialog: null });
  });
});

describe('AgentHub Chinese copy', () => {
  test('zh-CN replaces the old English child-page copy', () => {
    const zh = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/renderer/src/i18n/locales/zh-CN.json'), 'utf8')).agenthub;
    const forbidden = ['Create Project', 'Name *', 'Description', 'Project created', 'AGENTS', 'Select an Agent or create one.', 'Refresh Providers'];
    const flat = JSON.stringify(zh);
    for (const phrase of forbidden) assert.equal(flat.includes(phrase), false, phrase);
    assert.equal(zh.project.title, '创建项目');
    assert.equal(zh.project.name, '名称 *');
    assert.equal(zh.project.description, '描述');
    assert.equal(zh.project.created, '项目创建成功');
    assert.equal(zh.project.projectId, '项目 ID：');
    assert.equal(zh.agent.title, 'Agent 管理');
    assert.equal(zh.agent.empty, '请选择一个 Agent，或创建新 Agent。');
    assert.equal(zh.agent.refreshProviders, '刷新 Provider');
    assert.equal(zh.state.WAITING_APPROVAL, '等待批准');
    assert.equal(zh.state.APPROVED, '已批准');
  });

  test('panel source uses one open state and does not delay with setTimeout', () => {
    const badge = fs.readFileSync(path.join(process.cwd(), 'src/renderer/src/components/AgentHubBadge.tsx'), 'utf8');
    assert.match(badge, /isAgentHubPanelOpen/);
    assert.match(badge, /openAgentHubDialog\('create-project'\)/);
    assert.match(badge, /openAgentHubDialog\('agents'\)/);
    assert.match(badge, /triggerRef/);
    assert.match(badge, /panelRef/);
    assert.equal(badge.includes('setTimeout'), false);
    assert.equal(badge.includes('onMouseLeave'), false);
    assert.equal(badge.includes('z-index: 999999') || badge.includes('zIndex: 999999'), false);
  });
});
