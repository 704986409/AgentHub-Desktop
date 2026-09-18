import { useEffect, useState } from 'react';
import { useAgentHubStore } from '../stores/agentHubStore';
import { useAgentHubReviewSessionStore } from '../stores/agentHubReviewSessionStore';
import { AgentHubTaskModal } from './AgentHubTaskModal';
import { AgentHubExecuteModal } from './AgentHubExecuteModal';
import { AgentHubReviewEvidenceModal } from './AgentHubReviewEvidenceModal';

export function AgentHubBadge() {
  const {
    connection,
    health,
    snapshot,
    lastSyncAt,
    lastEventAt,
    lastError,
    isRefreshing,
    init,
    refresh
  } = useAgentHubStore();

  const [hover, setHover] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isExecuteModalOpen, setIsExecuteModalOpen] = useState(false);

  const reviewRecordCount = Object.keys(
    useAgentHubReviewSessionStore((s) => s.reviewReadyByTaskId)
  ).length;
  const isReviewModalOpen = useAgentHubReviewSessionStore((s) => s.isModalOpen);
  const openReviewModal = useAgentHubReviewSessionStore((s) => s.openModal);
  const closeReviewModal = useAgentHubReviewSessionStore((s) => s.closeModal);

  useEffect(() => {
    const cleanup = init();
    return cleanup;
  }, [init]);

  const agentCount = snapshot?.agents?.length ?? 0;
  const taskCount = snapshot?.tasks?.length ?? 0;

  // Visual status indicators
  let dotColor = 'var(--cth-ink-400, #94a3b8)';
  let label = 'AgentHub: Offline';
  let chipBg = 'transparent';

  switch (connection) {
    case 'connected':
      dotColor = 'var(--cth-mint-dark, #16a34a)';
      label = `AgentHub (${agentCount} agents · ${taskCount} tasks)`;
      chipBg = 'var(--cth-mint-light, #d0f0e0)';
      break;
    case 'connecting':
      dotColor = 'var(--cth-amber-dark, #ca8a04)';
      label = isRefreshing ? 'AgentHub: Refreshing...' : 'AgentHub: Connecting...';
      chipBg = 'var(--cth-amber-light, #f6e2b3)';
      break;
    case 'degraded':
      dotColor = 'var(--cth-peach-dark, #ea580c)';
      label = `AgentHub: Degraded (${agentCount} cached)`;
      chipBg = 'var(--cth-peach-light, #fed7aa)';
      break;
    case 'disconnected':
    default:
      dotColor = 'var(--cth-ink-400, #94a3b8)';
      label = 'AgentHub: Offline';
      chipBg = 'transparent';
      break;
  }

  const INK = 'var(--cth-ink-900, #0f172a)';

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        className="cth-titlebar-nodrag"
        onClick={() => { void refresh(); }}
        title="AgentHub Connection — Click to refresh"
        aria-label={label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 8px',
          margin: 0,
          background: chipBg,
          border: 'none',
          borderRadius: 2,
          boxShadow: connection !== 'disconnected' ? 'inset 0 0 0 1px var(--cth-ink-300, #cbd5e1)' : 'none',
          fontFamily: 'var(--cth-font-ui, sans-serif)',
          fontSize: 13,
          lineHeight: '18px',
          color: connection === 'disconnected' ? 'var(--cth-ink-500, #64748b)' : 'var(--cth-ink-900, #0f172a)',
          cursor: 'pointer'
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: dotColor,
            display: 'inline-block',
            flexShrink: 0
          }}
        />
        <span style={{ fontWeight: connection === 'connected' ? 600 : 400 }}>
          {label}
        </span>
      </button>

      {/* Hover tooltip card */}
      {hover && (
        <div
          role="tooltip"
          className="cth-titlebar-nodrag"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 400,
            width: 320,
            padding: '10px 12px',
            background: 'var(--cth-paper-100, #ffffff)',
            color: INK,
            border: `2px solid ${INK}`,
            boxShadow: `4px 4px 0 ${INK}`,
            fontFamily: 'var(--cth-font-ui, sans-serif)',
            fontSize: 12,
            lineHeight: 1.5,
            textAlign: 'left'
          }}
        >
          <div style={{ fontFamily: 'var(--cth-font-mono, monospace)', fontWeight: 700, fontSize: 12.5 }}>
            AgentHub Desktop Bridge
          </div>
          <div style={{ marginTop: 4, color: 'var(--cth-ink-700, #334155)' }}>
            <div><strong>Endpoint:</strong> http://127.0.0.1:3210</div>
            <div><strong>Status:</strong> {connection}</div>
            {health && (
              <div><strong>Backend Version:</strong> {health.version} ({health.status})</div>
            )}
            {lastSyncAt && (
              <div><strong>Last Sync:</strong> {new Date(lastSyncAt).toLocaleTimeString()}</div>
            )}
            {lastEventAt && (
              <div><strong>Last Event:</strong> {new Date(lastEventAt).toLocaleTimeString()}</div>
            )}
            {lastError && (
              <div style={{ color: 'var(--cth-rose-dark, #e11d48)', marginTop: 4 }}>
                <strong>Error [{lastError.code}]:</strong> {lastError.message}
              </div>
            )}
            {connection !== 'disconnected' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setHover(false);
                    setIsModalOpen(true);
                  }}
                  style={{
                    marginTop: 8,
                    width: '100%',
                    padding: '5px 8px',
                    background: 'var(--cth-mint-light, #d0f0e0)',
                    border: '1px solid var(--cth-mint-dark, #16a34a)',
                    color: 'var(--cth-mint-dark, #16a34a)',
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: 'pointer',
                    borderRadius: 2
                  }}
                >
                  + Submit New Task
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHover(false);
                    setIsExecuteModalOpen(true);
                  }}
                  style={{
                    marginTop: 6,
                    width: '100%',
                    padding: '5px 8px',
                    background: 'var(--cth-paper-100, #ffffff)',
                    border: '1px solid var(--cth-ink-900, #0f172a)',
                    color: 'var(--cth-ink-900, #0f172a)',
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: 'pointer',
                    borderRadius: 2
                  }}
                >
                  Execute Task
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setHover(false);
                openReviewModal();
              }}
              style={{
                marginTop: 6,
                width: '100%',
                padding: '5px 8px',
                background: 'var(--cth-paper-100, #ffffff)',
                border: '1px solid var(--cth-ink-900, #0f172a)',
                color: 'var(--cth-ink-900, #0f172a)',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                borderRadius: 2
              }}
            >
              Review Evidence ({reviewRecordCount})
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--cth-ink-500, #64748b)' }}>
            Click badge to refresh snapshot
          </div>
        </div>
      )}

      <AgentHubTaskModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
      <AgentHubExecuteModal
        isOpen={isExecuteModalOpen}
        onClose={() => setIsExecuteModalOpen(false)}
      />
      <AgentHubReviewEvidenceModal
        isOpen={isReviewModalOpen}
        onClose={closeReviewModal}
      />
    </span>
  );
}
