import { useEffect, useState } from 'react';
import { useAgentHubStore } from '../stores/agentHubStore';
import { useAgentHubReviewSessionStore } from '../stores/agentHubReviewSessionStore';
import { AgentHubTaskModal } from './AgentHubTaskModal';
import { AgentHubExecuteModal } from './AgentHubExecuteModal';
import { AgentHubReviewEvidenceModal } from './AgentHubReviewEvidenceModal';
import { AgentHubAgentManagementModal } from './AgentHubAgentManagementModal';
import { AgentHubLifecycleWorkspace } from './AgentHubLifecycleWorkspace';
import { AgentHubProjectCreateModal } from './AgentHubProjectCreateModal';
import { isLifecycleCompatibleBackendVersion } from '@shared/agenthubTypes';

export function AgentHubBadge() {
  const {
    connection,
    health,
    snapshot,
    lifecycleReviews,
    lastSyncAt,
    lastEventAt,
    lastError,
    isRefreshing,
    init,
    refresh
  } = useAgentHubStore();

  const [hover, setHover] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetNotice, setResetNotice] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isExecuteModalOpen, setIsExecuteModalOpen] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [isLifecycleOpen, setIsLifecycleOpen] = useState(false);
  const [isProjectCreateOpen, setIsProjectCreateOpen] = useState(false);

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

  useEffect(() => {
    const api = window.agentHub;
    if (!api?.isTestMode) return;
    let active = true;
    void api.isTestMode().then((enabled) => {
      if (active) setTestMode(enabled);
    }).catch(() => {
      if (active) setTestMode(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const agentCount = snapshot?.agents?.length ?? 0;
  const taskCount = snapshot?.tasks?.length ?? 0;
  const planCount = snapshot?.plans?.length ?? 0;
  const lifecycleCompatible = health !== null && isLifecycleCompatibleBackendVersion(health.version);

  const projectCount = snapshot?.projects.length ?? 0;
  const assignmentCount = snapshot?.assignments.length ?? 0;
  const reviewCount = lifecycleReviews?.length ?? reviewRecordCount;
  const connectionLabel = connection === 'connected'
    ? '已连接'
    : connection === 'connecting'
      ? '连接中'
      : connection === 'degraded'
        ? '降级'
        : '未连接';

  // Visual status indicators
  let dotColor = 'var(--cth-ink-400, #94a3b8)';
  let label = 'AgentHub：离线';
  let chipBg = 'transparent';

  switch (connection) {
    case 'connected':
      dotColor = 'var(--cth-mint-dark, #16a34a)';
      label = `AgentHub（${agentCount} 个 Agent · ${taskCount} 个任务）`;
      chipBg = 'var(--cth-mint-light, #d0f0e0)';
      break;
    case 'connecting':
      dotColor = 'var(--cth-amber-dark, #ca8a04)';
      label = isRefreshing ? 'AgentHub：正在刷新' : 'AgentHub：连接中';
      chipBg = 'var(--cth-amber-light, #f6e2b3)';
      break;
    case 'degraded':
      dotColor = 'var(--cth-peach-dark, #ea580c)';
      label = `AgentHub：降级（已缓存 ${agentCount}）`;
      chipBg = 'var(--cth-peach-light, #fed7aa)';
      break;
    case 'disconnected':
    default:
      dotColor = 'var(--cth-ink-400, #94a3b8)';
      label = 'AgentHub：离线';
      chipBg = 'transparent';
      break;
  }

  const INK = 'var(--cth-ink-900, #0f172a)';

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        if (!confirmReset && !resetting) setHover(false);
      }}
    >
      <button
        type="button"
        className="cth-titlebar-nodrag"
        onClick={() => { void refresh(); }}
        title="点击刷新 AgentHub 数据"
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
      {(hover || confirmReset || resetting) && (
        <div
          role="tooltip"
          className="cth-titlebar-nodrag"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 400,
            width: 360,
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
            AgentHub 桌面连接
          </div>
          <div style={{ marginTop: 4, color: 'var(--cth-ink-700, #334155)' }}>
            <div><strong>后端地址：</strong> http://127.0.0.1:3210</div>
            <div><strong>连接状态：</strong> {connectionLabel}</div>
            {health && (
              <div>
                <strong>后端版本：</strong> {health.version}
                {health.status === 'ok' && lifecycleCompatible ? '（兼容）' : ''}
              </div>
            )}
            {lastSyncAt && (
              <div><strong>上次同步：</strong> {new Date(lastSyncAt).toLocaleTimeString()}</div>
            )}
            {lastEventAt && (
              <div><strong>最近事件：</strong> {new Date(lastEventAt).toLocaleTimeString()}</div>
            )}
            {lastError && (
              <div style={{ color: 'var(--cth-rose-dark, #e11d48)', marginTop: 4 }}>
                <strong>错误 [{lastError.code}]：</strong> {lastError.message}
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
                  + 提交新任务
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHover(false);
                    setIsProjectCreateOpen(true);
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
                  + 创建项目
                </button>
                <div style={{ marginTop: 4, fontSize: 11 }}>项目（{projectCount}）</div>
                <button
                  type="button"
                  onClick={() => {
                    setHover(false);
                    setIsManageOpen(true);
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
                  管理 Agent（{agentCount}）
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHover(false);
                    setIsLifecycleOpen(true);
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
                  计划与生命周期{lifecycleCompatible ? `（${planCount} 个计划）` : '（不可用）'}
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
                  执行任务
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
              审查结果（{reviewCount}）
            </button>
            {testMode && (
              <div
                data-testid="agenthub-test-toolbar"
                style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--cth-ink-300, #cbd5e1)' }}
              >
                <div style={{ fontWeight: 700 }}>测试工具</div>
                <div>模式：测试模式</div>
                <div>数据库：agenthub-test.db</div>
                <div>
                  项目 {projectCount} / Agent {agentCount} / 计划 {planCount} / 任务 {taskCount} / Assignment {assignmentCount} / Review {reviewCount}
                </div>
                {confirmReset ? (
                  <div style={{ marginTop: 6 }}>
                    <div>确认清空测试数据库？</div>
                    <div>将清空项目、Agent、Plan、Task、Assignment、Review 和相关运行状态。</div>
                    <div>正式数据库不会受到影响。</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button
                        type="button"
                        disabled={resetting}
                        onClick={() => setConfirmReset(false)}
                        style={{ flex: 1, fontSize: 12, cursor: 'pointer' }}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        disabled={resetting}
                        onClick={() => {
                          if (resetting) return;
                          setResetting(true);
                          setResetNotice('正在清空...');
                          void window.agentHub.resetTestDatabase().then(async (result) => {
                            if (result.ok) {
                              await refresh();
                              setResetNotice('✅ 测试数据已清空');
                            } else {
                              setResetNotice(`❌ 清空失败：${result.error}`);
                            }
                          }).catch((error: unknown) => {
                            setResetNotice(`❌ 清空失败：${error instanceof Error ? error.message : '清空失败'}`);
                          }).finally(() => {
                            setResetting(false);
                            setConfirmReset(false);
                          });
                        }}
                        style={{ flex: 1, fontSize: 12, cursor: resetting ? 'default' : 'pointer' }}
                      >
                        {resetting ? '正在清空...' : '确认清空'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={resetting}
                    onClick={() => {
                      if (resetting) return;
                      setConfirmReset(true);
                    }}
                    style={{
                      marginTop: 6,
                      width: '100%',
                      padding: '5px 8px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: resetting ? 'default' : 'pointer'
                    }}
                  >
                    {resetting ? '正在清空...' : '🗑 一键清空测试数据'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { void refresh(); }}
                  style={{
                    marginTop: 6,
                    width: '100%',
                    padding: '5px 8px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  🔄 刷新状态
                </button>
                {resetNotice && <div style={{ marginTop: 6 }}>{resetNotice}</div>}
              </div>
            )}
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--cth-ink-500, #64748b)' }}>
            点击顶部状态栏刷新数据
          </div>
        </div>
      )}

      <AgentHubTaskModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onRequestCreateProject={() => setIsProjectCreateOpen(true)}
      />
      <AgentHubExecuteModal
        isOpen={isExecuteModalOpen}
        onClose={() => setIsExecuteModalOpen(false)}
      />
      <AgentHubReviewEvidenceModal
        isOpen={isReviewModalOpen}
        onClose={closeReviewModal}
      />
      <AgentHubAgentManagementModal
        isOpen={isManageOpen}
        onClose={() => setIsManageOpen(false)}
      />
      <AgentHubLifecycleWorkspace
        isOpen={isLifecycleOpen}
        onClose={() => setIsLifecycleOpen(false)}
        onRequestCreateProject={() => setIsProjectCreateOpen(true)}
      />
      <AgentHubProjectCreateModal
        isOpen={isProjectCreateOpen}
        onClose={() => setIsProjectCreateOpen(false)}
      />
    </span>
  );
}
