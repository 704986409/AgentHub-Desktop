import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentHubStore } from '../stores/agentHubStore';
import { useAgentHubReviewSessionStore } from '../stores/agentHubReviewSessionStore';
import {
  AGENTHUB_PANEL_Z,
  isOutsideAgentHubPanel,
  reduceAgentHubPanel,
  type AgentHubDialogKind,
  type AgentHubPanelState
} from './agentHubPanel';
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
  const { t } = useTranslation();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelState, setPanelState] = useState<AgentHubPanelState>({ open: false, dialog: null });
  const [testMode, setTestMode] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetNotice, setResetNotice] = useState('');

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

  const isAgentHubPanelOpen = panelState.open;
  const activeDialog = panelState.dialog;

  const openAgentHubDialog = (kind: AgentHubDialogKind): void => {
    setPanelState((current) => reduceAgentHubPanel(current, { type: 'open-dialog', dialog: kind }));
    if (kind === 'reviews') openReviewModal();
  };

  const closeAgentHubDialog = (): void => {
    setPanelState((current) => reduceAgentHubPanel(current, { type: 'close-dialog' }));
    closeReviewModal();
  };

  const toggleAgentHubPanel = (): void => {
    setPanelState((current) => reduceAgentHubPanel(current, { type: 'toggle' }));
  };

  useEffect(() => {
    if (!isAgentHubPanelOpen && activeDialog === null && !isReviewModalOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (activeDialog !== null || isReviewModalOpen) {
        closeAgentHubDialog();
        return;
      }
      setPanelState((current) => reduceAgentHubPanel(current, { type: 'escape' }));
    };
    const onDocumentPointerDown = (event: PointerEvent): void => {
      if (!isAgentHubPanelOpen) return;
      const target = event.target instanceof Node ? event.target : null;
      if (!isOutsideAgentHubPanel(target, triggerRef.current, panelRef.current)) return;
      setPanelState((current) => reduceAgentHubPanel(current, { type: 'outside' }));
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onDocumentPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onDocumentPointerDown);
    };
  }, [isAgentHubPanelOpen, activeDialog, isReviewModalOpen, closeReviewModal]);

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
    >
      <button
        ref={triggerRef}
        type="button"
        className="cth-titlebar-nodrag"
        onClick={toggleAgentHubPanel}
        title={t('agenthub.badge.toggle', '点击打开或关闭 AgentHub')}
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
      {isAgentHubPanelOpen && (
        <div
          ref={panelRef}
          role="dialog"
          className="cth-titlebar-nodrag"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: AGENTHUB_PANEL_Z,
            width: 360,
            maxHeight: '70vh',
            overflowY: 'auto',
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
                  onClick={() => openAgentHubDialog('submit-task')}
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
                  onClick={() => openAgentHubDialog('create-project')}
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
                  onClick={() => openAgentHubDialog('agents')}
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
                  onClick={() => openAgentHubDialog('lifecycle')}
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
                  onClick={() => openAgentHubDialog('execute-task')}
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
              onClick={() => openAgentHubDialog('reviews')}
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
        isOpen={activeDialog === 'submit-task'}
        onClose={closeAgentHubDialog}
        onRequestCreateProject={() => openAgentHubDialog('create-project')}
      />
      <AgentHubExecuteModal
        isOpen={activeDialog === 'execute-task'}
        onClose={closeAgentHubDialog}
      />
      <AgentHubReviewEvidenceModal
        isOpen={isReviewModalOpen}
        onClose={closeAgentHubDialog}
      />
      <AgentHubAgentManagementModal
        isOpen={activeDialog === 'agents'}
        onClose={closeAgentHubDialog}
      />
      <AgentHubLifecycleWorkspace
        isOpen={activeDialog === 'lifecycle'}
        onClose={closeAgentHubDialog}
        onRequestCreateProject={() => openAgentHubDialog('create-project')}
      />
      <AgentHubProjectCreateModal
        isOpen={activeDialog === 'create-project'}
        onClose={closeAgentHubDialog}
      />
    </span>
  );
}
