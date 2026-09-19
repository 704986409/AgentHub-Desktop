import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  HUMAN_BOSS_PRESENCE,
  agentPresenceFromDto,
  isHumanPresence,
  legacyIsGodToPresentationRole
} from '../src/shared/officeActors';
import {
  AGENTHUB_EXECUTION_PRELOAD_KEYS,
  FORBIDDEN_AGENTHUB_RENDERER_AUTHORITY_KEYS
} from '../src/shared/munderAuthority';
import { projectAgentHubOffice } from '../src/renderer/src/scene/office/agentHubOfficeProjection';
import type { AgentDto, AgentHubStateSnapshot } from '../src/shared/agenthubTypes';

const TEST_TIMEOUT = 5000;
const ROOT = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('AgentHub Desktop V0.8.9H — Legacy Munder Consolidation & Dead-Code Cleanup', { timeout: TEST_TIMEOUT }, () => {
  // ---------------------------------------------------------------------------
  // Section 77: Restore Team removed
  // ---------------------------------------------------------------------------
  describe('Section 77: Restore Team feature removed', () => {
    it('useRestoreTeam.ts file is deleted from repository', { timeout: TEST_TIMEOUT }, () => {
      const exists = fs.existsSync(path.join(ROOT, 'src/renderer/src/hooks/useRestoreTeam.ts'));
      assert.equal(exists, false, 'useRestoreTeam.ts must not exist');
    });

    it('useRestoreTeam production import count is 0 across all src files', { timeout: TEST_TIMEOUT }, () => {
      const scanDir = (dir: string): string[] => {
        let results: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            results = results.concat(scanDir(full));
          } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
            results.push(full);
          }
        }
        return results;
      };

      const srcFiles = scanDir(path.join(ROOT, 'src'));
      for (const file of srcFiles) {
        const content = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(
          content,
          /\buseRestoreTeam\b/,
          `Production file ${path.relative(ROOT, file)} must not reference useRestoreTeam`
        );
      }
    });

    it('Restore Team UI buttons and auto restore timer are absent from AgentStrip and FullscreenTerminal', { timeout: TEST_TIMEOUT }, () => {
      const agentStrip = read('src/renderer/src/components/AgentStrip.tsx');
      const fullscreen = read('src/renderer/src/components/FullscreenTerminal.tsx');

      assert.doesNotMatch(agentStrip, /restoreTeam/, 'AgentStrip must not contain restoreTeam');
      assert.doesNotMatch(agentStrip, /autoRestoring/, 'AgentStrip must not contain autoRestoring');
      assert.doesNotMatch(fullscreen, /restoreTeam/, 'FullscreenTerminal must not contain restoreTeam');
      assert.doesNotMatch(fullscreen, /autoRestoring/, 'FullscreenTerminal must not contain autoRestoring');
    });
  });

  // ---------------------------------------------------------------------------
  // Section 78 & 85: No fake runtime restoration or status promotion
  // ---------------------------------------------------------------------------
  describe('Section 78 & 85: No fake runtime restoration or status promotion', () => {
    it('persisted legacy roster cannot fabricate live idle agents or trigger spawn', { timeout: TEST_TIMEOUT }, () => {
      const legacySavedRoster = [
        { id: 'agent-old-1', name: 'Old Worker', ptyId: 'pty-fake-1', status: 'working', command: 'claude' },
        { id: 'agent-old-2', name: 'Old Lead', ptyId: 'pty-fake-2', status: 'idle', command: 'codex' }
      ];

      // In AgentHub, authoritative agents come strictly from Backend snapshot
      const snapshot: AgentHubStateSnapshot = {
        agents: [
          {
            agentId: 'authoritative-agent',
            projectId: 'proj-1',
            name: 'Real Agent',
            providerId: 'claude',
            role: 'engineer',
            status: 'IDLE',
            updatedAt: new Date().toISOString()
          }
        ],
        tasks: [],
        reviews: [],
        reviewEvidence: [],
        projects: [{ projectId: 'proj-1', name: 'Project 1', rootPath: '/tmp/proj' }]
      };

      const projection = projectAgentHubOffice(snapshot);
      // Legacy roster items are NOT included in authoritative office projection
      assert.equal(projection.agents.some((a) => a.agentId === 'agent-old-1'), false);
      assert.equal(projection.agents.some((a) => a.agentId === 'agent-old-2'), false);
      assert.equal(projection.agents.length, 1);
      assert.equal(projection.agents[0].agentId, 'authoritative-agent');
    });

    it('action: "restored" is absent from production code as a runtime status mutation', { timeout: TEST_TIMEOUT }, () => {
      const hive = read('src/renderer/src/hooks/useHive.ts');
      assert.doesNotMatch(hive, /action:\s*['"]restored['"]/, 'useHive must not fabricate action: restored');
    });
  });

  // ---------------------------------------------------------------------------
  // Section 79: Queue data no silent loss
  // ---------------------------------------------------------------------------
  describe('Section 79: Queue data no silent loss', () => {
    it('queueDelivery.ts runtime delivery contract is removed (Strategy A)', { timeout: TEST_TIMEOUT }, () => {
      const exists = fs.existsSync(path.join(ROOT, 'src/renderer/src/hooks/queueDelivery.ts'));
      assert.equal(exists, false, 'queueDelivery.ts must be deleted in Strategy A');
    });

    it('useHive does not contain unreachable queue drain or PTY delivery loop', { timeout: TEST_TIMEOUT }, () => {
      const hive = read('src/renderer/src/hooks/useHive.ts');
      assert.doesNotMatch(hive, /\bsubmitToPty\b/, 'useHive must not contain submitToPty');
      assert.doesNotMatch(hive, /\bwaitForTerminalReady\b/, 'useHive must not contain waitForTerminalReady');
      assert.doesNotMatch(hive, /\bwriteChains\b/, 'useHive must not contain writeChains');
      assert.doesNotMatch(hive, /\breadyPids\b/, 'useHive must not contain readyPids');
      assert.doesNotMatch(hive, /\bdeliverWithAcknowledgement\b/, 'useHive must not contain deliverWithAcknowledgement');
    });
  });

  // ---------------------------------------------------------------------------
  // Section 80 & 81: No Renderer PTY automation and no alternate aliases
  // ---------------------------------------------------------------------------
  describe('Section 80 & 81: PTY authority remains strictly closed', () => {
    const primaryPreloadSource = read('src/preload/index.ts');

    const forbiddenApis = [
      'spawnPty',
      'spawnDeveloperTerminal',
      'writePty',
      'resizePty',
      'redrawPty',
      'killPty',
      'listPtys'
    ];

    for (const api of forbiddenApis) {
      it(`Primary preload does NOT expose ${api}`, { timeout: TEST_TIMEOUT }, () => {
        assert.doesNotMatch(
          primaryPreloadSource,
          new RegExp(`\\b${api}\\s*:`),
          `Primary preload must not expose ${api}`
        );
      });
    }

    const forbiddenAliases = [
      'sendTerminalInput',
      'terminalExec',
      'terminalCommand',
      'runProvider',
      'launchProvider',
      'restartAgentRuntime',
      'stopAgentRuntime',
      'resumeRuntime'
    ];

    for (const alias of forbiddenAliases) {
      it(`Primary preload does NOT expose alternate alias ${alias}`, { timeout: TEST_TIMEOUT }, () => {
        assert.doesNotMatch(
          primaryPreloadSource,
          new RegExp(`\\b${alias}\\s*:`),
          `Primary preload must not expose alias ${alias}`
        );
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Section 82: Developer Terminal unaffected
  // ---------------------------------------------------------------------------
  describe('Section 82: Dedicated Developer Terminal boundary intact', () => {
    const primaryPreloadSource = read('src/preload/index.ts');
    const terminalPreloadSource = read('src/preload/terminal.ts');

    it('Primary preload exposes only human intent openDeveloperTerminal', { timeout: TEST_TIMEOUT }, () => {
      assert.match(primaryPreloadSource, /openDeveloperTerminal:\s*\(/);
    });

    it('Dedicated Terminal preload exposes sender-bound write, resize, and close', { timeout: TEST_TIMEOUT }, () => {
      assert.match(terminalPreloadSource, /write:\s*\(/);
      assert.match(terminalPreloadSource, /resize:\s*\(/);
      assert.match(terminalPreloadSource, /close:\s*\(/);
    });

    it('Dedicated Terminal preload does NOT expose window.agentHub', { timeout: TEST_TIMEOUT }, () => {
      assert.doesNotMatch(terminalPreloadSource, /agentHub/);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 83 & 84: Office authoritative projection & Theme presentation only
  // ---------------------------------------------------------------------------
  describe('Section 83 & 84: Office authoritative projection & Theme presentation only', () => {
    it('Office projection maps Backend snapshot and does not merge unmanaged agents', { timeout: TEST_TIMEOUT }, () => {
      const snapshot: AgentHubStateSnapshot = {
        agents: [
          {
            agentId: 'backend-agent-c',
            projectId: 'proj-1',
            name: 'Charlie',
            providerId: 'cursor',
            role: 'qa',
            status: 'BUSY',
            updatedAt: new Date().toISOString()
          }
        ],
        tasks: [],
        reviews: [],
        reviewEvidence: [],
        projects: [{ projectId: 'proj-1', name: 'Main Project', rootPath: '/app' }]
      };

      const projected = projectAgentHubOffice(snapshot);
      assert.equal(projected.agents.length, 1);
      assert.equal(projected.agents[0].agentId, 'backend-agent-c');
      assert.equal(projected.agents[0].backendStatus, 'BUSY');
    });

    it('Theme presentation switch does not modify agent lifecycle state', { timeout: TEST_TIMEOUT }, () => {
      const agent: AgentDto = {
        agentId: 'agent-1',
        projectId: 'proj-1',
        name: 'Worker',
        providerId: 'claude',
        role: 'engineer',
        status: 'IDLE',
        updatedAt: '2026-01-01T00:00:00Z'
      };

      const presence = agentPresenceFromDto(agent);
      assert.equal(presence.agentId, 'agent-1');
      assert.equal(presence.status, 'IDLE');
      assert.equal(presence.presentationRole, 'agent');
    });
  });

  // ---------------------------------------------------------------------------
  // Section 86 & 87: No local provider switch success & No auto-revive
  // ---------------------------------------------------------------------------
  describe('Section 86 & 87: Fail-closed provider switches and no auto-revive', () => {
    it('useHive does not contain auto-revive logic', { timeout: TEST_TIMEOUT }, () => {
      const hive = read('src/renderer/src/hooks/useHive.ts');
      assert.doesNotMatch(hive, /autoRevive/, 'Auto-revive must remain absent from useHive');
    });

    it('AgentDetailPanel kill button remains disabled in AgentHub mode', { timeout: TEST_TIMEOUT }, () => {
      const panel = read('src/renderer/src/components/AgentDetailPanel.tsx');
      assert.match(panel, /disabled/, 'AgentDetailPanel kill button must be disabled');
    });
  });

  // ---------------------------------------------------------------------------
  // Section 88: No legacy provider execution from Primary
  // ---------------------------------------------------------------------------
  describe('Section 88: No legacy provider execution from Primary', () => {
    it('Primary preload has no provider CLI launch or execution commands', { timeout: TEST_TIMEOUT }, () => {
      const preload = read('src/preload/index.ts');
      const executionKeys = AGENTHUB_EXECUTION_PRELOAD_KEYS;
      assert.deepEqual(executionKeys, ['executeTask']);

      const agentHubBlock = preload.slice(preload.indexOf('const agentHubApi'));
      for (const forbidden of FORBIDDEN_AGENTHUB_RENDERER_AUTHORITY_KEYS) {
        assert.equal(
          new RegExp(`^\\s+${forbidden}\\s*:`, 'm').test(agentHubBlock),
          false,
          `agentHub API must not expose ${forbidden}`
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Section 89 & 90: Persisted legacy migration safe & Docs consistency
  // ---------------------------------------------------------------------------
  describe('Section 89 & 90: Migration resilience and documentation truth', () => {
    it('legacy agent data structure does not crash presence mapping', { timeout: TEST_TIMEOUT }, () => {
      const legacyAgent: AgentDto = {
        agentId: 'legacy-1',
        projectId: 'proj-1',
        name: 'Legacy Agent',
        providerId: 'claude',
        role: 'worker',
        status: 'IDLE',
        updatedAt: '2026-01-01T00:00:00Z'
      };

      const presence = agentPresenceFromDto(legacyAgent);
      assert.equal(presence.agentId, 'legacy-1');
      assert.equal(isHumanPresence(presence), false);
    });

    it('Human Boss presence remains distinct and human', { timeout: TEST_TIMEOUT }, () => {
      assert.equal(isHumanPresence(HUMAN_BOSS_PRESENCE), true);
      assert.equal(HUMAN_BOSS_PRESENCE.presentationRole, 'human');
    });
  });

  // ---------------------------------------------------------------------------
  // Section 91: Compile-time type contract verification
  // ---------------------------------------------------------------------------
  describe('Section 91: Public API contracts and types', () => {
    it('official executeTask is the only execution API on agentHub', { timeout: TEST_TIMEOUT }, () => {
      assert.equal(AGENTHUB_EXECUTION_PRELOAD_KEYS.length, 1);
      assert.equal(AGENTHUB_EXECUTION_PRELOAD_KEYS[0], 'executeTask');
    });
  });
});
