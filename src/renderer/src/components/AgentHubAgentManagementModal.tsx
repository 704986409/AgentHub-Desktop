import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAgentHubStore } from '../stores/agentHubStore';
import { AGENTHUB_MODAL_Z } from './agentHubPanel';
import { useAgentHubAgentMutationStore } from '../stores/agentHubAgentMutationStore';
import {
  leadAgentLifecycleReferences,
  type AgentMutationResult,
  type CreateAgentInputDto,
  type UpdateAgentInputDto,
  type ProviderDto
} from '@shared/agenthubTypes';
import {
  AgentHubAgentForm,
  emptyAgentFormValue,
  formFromAgent,
  formatProviderStatus,
  toCreateInput,
  toUpdateInput,
  isProviderUsable,
  type AgentHubAgentFormValue
} from './AgentHubAgentForm';

interface AgentHubAgentManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AgentHubAgentManagementModal({ isOpen, onClose }: AgentHubAgentManagementModalProps) {
  const { t } = useTranslation();
  const snapshot = useAgentHubStore((s) => s.snapshot);
  const connection = useAgentHubStore((s) => s.connection);
  const providerCatalog = useAgentHubStore((s) => s.providerCatalog);
  const providerCatalogStatus = useAgentHubStore((s) => s.providerCatalogStatus);
  const refreshProviderCatalog = useAgentHubStore((s) => s.refreshProviderCatalog);

  const createAgent = useAgentHubStore((s) => s.createAgent);
  const updateAgent = useAgentHubStore((s) => s.updateAgent);
  const enableAgent = useAgentHubStore((s) => s.enableAgent);
  const disableAgent = useAgentHubStore((s) => s.disableAgent);
  const deleteAgent = useAgentHubStore((s) => s.deleteAgent);

  const agents = snapshot?.agents ?? [];
  const projects = snapshot?.projects ?? [];
  const mutationsUsable = connection === 'connected' || connection === 'degraded';

  const session = useAgentHubAgentMutationStore((s) => s.session);
  const startFreshCreate = useAgentHubAgentMutationStore((s) => s.startFreshCreate);
  const startFreshUpdate = useAgentHubAgentMutationStore((s) => s.startFreshUpdate);
  const startFreshAction = useAgentHubAgentMutationStore((s) => s.startFreshAction);
  const markSubmitting = useAgentHubAgentMutationStore((s) => s.markSubmitting);
  const markAmbiguous = useAgentHubAgentMutationStore((s) => s.markAmbiguous);
  const markApplied = useAgentHubAgentMutationStore((s) => s.markApplied);
  const markFailed = useAgentHubAgentMutationStore((s) => s.markFailed);
  const rotateAfterEdit = useAgentHubAgentMutationStore((s) => s.rotateAfterEdit);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  const [form, setForm] = useState<AgentHubAgentFormValue>(emptyAgentFormValue());
  const [confirmKind, setConfirmKind] = useState<'create' | 'runtime' | 'disable' | 'delete' | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      void refreshProviderCatalog();
    }
  }, [isOpen, refreshProviderCatalog]);

  const selected = useMemo(
    () => agents.find((agent) => agent.agentId === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  useEffect(() => {
    if (selectedAgentId && !agents.some((agent) => agent.agentId === selectedAgentId)) {
      setSelectedAgentId(null);
      setMode('view');
    }
  }, [agents, selectedAgentId]);

  if (!isOpen) return null;

  const busy = selected?.status === 'BUSY';
  const submitting = session?.status === 'submitting';
  const ambiguous = session?.status === 'ambiguous';
  const formDisabled = submitting || !mutationsUsable;

  const providerSupported = (providerId: string): boolean => isProviderUsable(providerId, providerCatalog);
  const providerUsable = selected ? providerSupported(selected.providerId) : false;

  const canEnable = Boolean(
    selected &&
    mutationsUsable &&
    !submitting &&
    !busy &&
    !selected.enabled &&
    providerSupported(selected.providerId)
  );

  const canDisable = Boolean(
    selected &&
    mutationsUsable &&
    !submitting &&
    !busy &&
    selected.enabled
  );

  const canDelete = Boolean(
    selected &&
    mutationsUsable &&
    !submitting &&
    !busy
  );

  const canEdit = Boolean(
    selected &&
    mutationsUsable &&
    !submitting &&
    !busy
  );

  const isReconciliation = Boolean(session?.error?.code?.includes('RECONCILIATION'));

  const applyResult = (mutationId: string, result: AgentMutationResult): void => {
    if (result.status === 'applied') {
      markApplied(mutationId);
      setConfirmKind(null);
      setMode('view');
      if (!result.stateSynchronized) {
        setSyncWarning('AgentHub confirmed the Agent change, but Desktop could not refresh authoritative state.');
      } else {
        setSyncWarning(null);
      }
      return;
    }
    if (result.status === 'failed') {
      markFailed(mutationId, result.error);
      return;
    }
    markAmbiguous(mutationId, result.error);
  };

  const changeForm = (next: AgentHubAgentFormValue): void => {
    if (session?.status === 'ambiguous' && (session.operation === 'create' || session.operation === 'update')) {
      const input = session.operation === 'create' ? toCreateInput(next) : toUpdateInput(next);
      rotateAfterEdit(session.mutationId, input);
    }
    setForm(next);
  };

  const submitCreate = async (isRetry = false): Promise<void> => {
    const input: CreateAgentInputDto = toCreateInput(form);
    const mutationId = isRetry && session?.operation === 'create' && session.status === 'ambiguous'
      ? session.mutationId
      : startFreshCreate();
    markSubmitting(mutationId);
    applyResult(mutationId, await createAgent({ mutationId, input }));
  };

  const submitUpdate = async (isRetry = false): Promise<void> => {
    if (!selected) return;
    const input: UpdateAgentInputDto = toUpdateInput(form);
    const mutationId = isRetry && session?.operation === 'update' && session.status === 'ambiguous'
      ? session.mutationId
      : startFreshUpdate(selected.agentId, input);
    markSubmitting(mutationId);
    applyResult(mutationId, await updateAgent({ mutationId, agentId: selected.agentId, input }));
  };

  const submitAction = async (operation: 'enable' | 'disable' | 'delete', isRetry = false): Promise<void> => {
    if (!selected) return;
    const mutationId = isRetry && session?.operation === operation && session.agentId === selected.agentId && session.status === 'ambiguous'
      ? session.mutationId
      : startFreshAction(operation, selected.agentId);
    markSubmitting(mutationId);
    const request = { mutationId, agentId: selected.agentId };
    const result = operation === 'enable'
      ? await enableAgent(request)
      : operation === 'disable'
        ? await disableAgent(request)
        : await deleteAgent(request);
    applyResult(mutationId, result);
  };

  const retrySame = async (): Promise<void> => {
    if (!session || session.status !== 'ambiguous') return;
    if (session.operation === 'create') {
      await submitCreate(true);
      return;
    }
    if (session.operation === 'update') {
      await submitUpdate(true);
      return;
    }
    await submitAction(session.operation, true);
  };

  const isFormCreateEnabledUsable = isProviderUsable(form.providerId, providerCatalog);
  const canConfirmCreate = mutationsUsable && !submitting && !ambiguous && (!form.enabled || isFormCreateEnabledUsable);

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: AGENTHUB_MODAL_Z, background: 'rgba(15,23,42,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        width: 920, maxWidth: '95vw', maxHeight: '88vh', overflow: 'auto',
        background: '#fff', border: '3px solid #0f172a', boxShadow: '6px 6px 0 #0f172a', padding: 16
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong>{t('agenthub.agent.title', 'AGENTHUB AGENTS')}</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              disabled={providerCatalogStatus === 'loading'}
              onClick={() => { void refreshProviderCatalog(); }}
              style={{ fontSize: 12, padding: '2px 8px' }}
            >
              {providerCatalogStatus === 'loading' ? t('agenthub.agent.refreshing', 'Refreshing Providers...') : t('agenthub.agent.refreshProviders', 'Refresh Providers')}
            </button>
            <button type="button" onClick={onClose}>{t('agenthub.common.close', 'Close')}</button>
          </div>
        </div>
        {snapshot === null && <div>AGENTHUB STATE UNAVAILABLE</div>}
        {!mutationsUsable && <div>Agent mutations are disabled until AgentHub is usable.</div>}
        {syncWarning && <div style={{ color: '#ca8a04', marginBottom: 8 }}>{syncWarning}</div>}
        {ambiguous && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>{t('agenthub.agent.unknown', 'AGENT MUTATION OUTCOME UNKNOWN')}</div>
            <div>{session?.error?.code}: {session?.error?.message}</div>
            {isReconciliation ? (
              <div>Refresh or restart AgentHub before another Agent mutation.</div>
            ) : (
              <button type="button" onClick={() => { void retrySame(); }} disabled={!mutationsUsable || submitting}>
                {t('agenthub.agent.retry', 'Retry Same Mutation')}
              </button>
            )}
          </div>
        )}
        {session?.status === 'failed' && (
          <div style={{ color: '#e11d48', marginBottom: 8 }}>
            {session.error?.code}: {session.error?.message}
            {session.operation === 'delete' && selectedAgentId && snapshot && (() => {
              const refs = leadAgentLifecycleReferences(selectedAgentId, snapshot);
              if (refs.intakeIds.length === 0 && refs.planIds.length === 0) return null;
              return (
                <div>
                  This Agent is still referenced as Lead Agent by Intake/Plan and cannot be deleted.
                  Intakes: {refs.intakeIds.join(', ') || 'none'}; Plans: {refs.planIds.join(', ') || 'none'}.
                </div>
              );
            })()}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16 }}>
          <div>
            {agents.map((agent) => (
              <button
                key={agent.agentId}
                type="button"
                onClick={() => {
                  setSelectedAgentId(agent.agentId);
                  setMode('view');
                  setForm(formFromAgent(agent));
                }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', marginBottom: 6,
                  background: selectedAgentId === agent.agentId ? '#d0f0e0' : '#fff'
                }}
              >
                {agent.name}
                <div style={{ fontSize: 11, color: '#64748b' }}>{agent.providerId} · {agent.status}</div>
              </button>
            ))}
            <button
              type="button"
              disabled={!mutationsUsable || submitting}
              onClick={() => {
                startFreshCreate();
                setMode('create');
                setForm(emptyAgentFormValue());
                setConfirmKind(null);
              }}
            >
              {t('agenthub.agent.create', 'Create Agent')}
            </button>
          </div>
          <div>
            {mode === 'create' && (
              <>
                <AgentHubAgentForm mode="create" value={form} projects={projects} disabled={formDisabled} onChange={changeForm} />
                {confirmKind === 'create' ? (
                  <div style={{ marginTop: 12 }}>
                    <div>Name: {form.name}</div>
                    <div>Provider: {form.providerId}</div>
                    <div>Model: {form.modelId}</div>
                    <div>Scope: {form.projectId ?? 'Global'}</div>
                    <div>Enabled: {String(form.enabled)}</div>
                    {!canConfirmCreate && form.enabled && !isFormCreateEnabledUsable && (
                      <div style={{ color: '#ea580c', fontWeight: 700, margin: '6px 0' }}>
                        Cannot create enabled agent: provider is not usable
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={!canConfirmCreate}
                      onClick={() => { void submitCreate(); }}
                    >
                      {t('agenthub.agent.confirmCreate', 'Confirm Create')}
                    </button>
                  </div>
                ) : (
                  <button type="button" disabled={!mutationsUsable || submitting || ambiguous} onClick={() => setConfirmKind('create')}>
                    {t('agenthub.agent.reviewCreate', 'Review Create')}
                  </button>
                )}
              </>
            )}
            {mode !== 'create' && selected && (
              <>
                <div style={{ marginBottom: 8, fontSize: 12 }}>
                  <div>Agent ID: {selected.agentId}</div>
                  <div>Project Scope: {selected.projectId ?? 'Global'}</div>
                  <div>Status: {selected.status}</div>
                  <div>Enabled: {String(selected.enabled)}</div>
                  <div>Created At: {selected.createdAt}</div>
                  <div>Updated At: {selected.updatedAt}</div>
                  {!providerUsable && (
                    <div style={{ color: '#ea580c', fontWeight: 700 }}>
                      Runtime provider unavailable{providerCatalog?.find((p) => p.providerId === selected.providerId) ? ` (${formatProviderStatus(providerCatalog.find((p) => p.providerId === selected.providerId)!.status)})` : ''}
                    </div>
                  )}
                </div>
                {mode === 'edit' ? (
                  <>
                    <AgentHubAgentForm mode="edit" value={form} projects={projects} disabled={formDisabled || busy} onChange={changeForm} />
                    {confirmKind === 'runtime' ? (
                      <div>
                        This changes the runtime provider/model used for future assignments. The Agent must be idle.
                        <button type="button" disabled={busy || submitting || ambiguous} onClick={() => { void submitUpdate(); }}>Confirm Runtime Change</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={busy || submitting || ambiguous || !mutationsUsable}
                        onClick={() => {
                          if (form.providerId !== selected.providerId || form.modelId !== selected.modelId) {
                            setConfirmKind('runtime');
                            return;
                          }
                          void submitUpdate();
                        }}
                      >
                        Save Profile
                      </button>
                    )}
                  </>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" disabled={!canEdit} onClick={() => { setMode('edit'); setForm(formFromAgent(selected)); setConfirmKind(null); }}>
                      {t('agenthub.agent.edit', 'Edit')}
                    </button>
                    <button
                      type="button"
                      disabled={!canEnable}
                      onClick={() => { void submitAction('enable'); }}
                    >
                      {t('agenthub.agent.enable', 'Enable')}
                    </button>
                    {confirmKind === 'disable' ? (
                      <div>
                        Disabling removes this Agent from future scheduling. It does not delete Agent history.
                        <button type="button" disabled={!canDisable} onClick={() => { void submitAction('disable'); }}>{t('agenthub.agent.confirmDisable', 'Confirm Disable')}</button>
                      </div>
                    ) : (
                      <button type="button" disabled={!canDisable} onClick={() => setConfirmKind('disable')}>{t('agenthub.agent.disable', 'Disable')}</button>
                    )}
                    {confirmKind === 'delete' ? (
                      <div>
                        {t('agenthub.agent.deleteHint', 'Only Agents with no Assignment history can be deleted. Use Disable for Agents that have history.')}
                        <button type="button" disabled={!canDelete} onClick={() => { void submitAction('delete'); }}>{t('agenthub.agent.confirmDelete', 'Confirm Delete')}</button>
                      </div>
                    ) : (
                      <button type="button" disabled={!canDelete} onClick={() => setConfirmKind('delete')}>{t('agenthub.agent.delete', 'Delete')}</button>
                    )}
                  </div>
                )}
              </>
            )}
            {mode !== 'create' && !selected && <div>{t('agenthub.agent.empty', 'Select an Agent or create one.')}</div>}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
