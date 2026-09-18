import { useEffect, useMemo, useState } from 'react';
import { useAgentHubStore } from '../stores/agentHubStore';
import { useAgentHubAgentMutationStore } from '../stores/agentHubAgentMutationStore';
import type { AgentMutationResult, CreateAgentInputDto, UpdateAgentInputDto } from '@shared/agenthubTypes';
import { ACTIONABLE_AGENT_PROVIDER_IDS } from '@shared/agenthubTypes';
import {
  AgentHubAgentForm,
  emptyAgentFormValue,
  formFromAgent,
  toCreateInput,
  toUpdateInput,
  type AgentHubAgentFormValue
} from './AgentHubAgentForm';

interface AgentHubAgentManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function providerSupported(providerId: string): boolean {
  return (ACTIONABLE_AGENT_PROVIDER_IDS as readonly string[]).includes(providerId);
}

export function AgentHubAgentManagementModal({ isOpen, onClose }: AgentHubAgentManagementModalProps) {
  const snapshot = useAgentHubStore((s) => s.snapshot);
  const connection = useAgentHubStore((s) => s.connection);
  const createAgent = useAgentHubStore((s) => s.createAgent);
  const updateAgent = useAgentHubStore((s) => s.updateAgent);
  const enableAgent = useAgentHubStore((s) => s.enableAgent);
  const disableAgent = useAgentHubStore((s) => s.disableAgent);
  const deleteAgent = useAgentHubStore((s) => s.deleteAgent);
  const agents = snapshot?.agents ?? [];
  const projects = snapshot?.projects ?? [];
  const mutationsUsable = connection === 'connected' || connection === 'degraded';

  const session = useAgentHubAgentMutationStore((s) => s.session);
  const beginCreate = useAgentHubAgentMutationStore((s) => s.beginCreate);
  const beginUpdate = useAgentHubAgentMutationStore((s) => s.beginUpdate);
  const beginAction = useAgentHubAgentMutationStore((s) => s.beginAction);
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

  const submitCreate = async (): Promise<void> => {
    const input: CreateAgentInputDto = toCreateInput(form);
    const mutationId = session?.operation === 'create' ? session.mutationId : beginCreate();
    markSubmitting(mutationId);
    applyResult(mutationId, await createAgent({ mutationId, input }));
  };

  const submitUpdate = async (): Promise<void> => {
    if (!selected) return;
    const input: UpdateAgentInputDto = toUpdateInput(form);
    const mutationId = session?.operation === 'update' ? session.mutationId : beginUpdate(selected.agentId, input);
    markSubmitting(mutationId);
    applyResult(mutationId, await updateAgent({ mutationId, agentId: selected.agentId, input }));
  };

  const submitAction = async (operation: 'enable' | 'disable' | 'delete'): Promise<void> => {
    if (!selected) return;
    const mutationId = session?.operation === operation && session.agentId === selected.agentId
      ? session.mutationId
      : beginAction(operation, selected.agentId);
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
      await submitCreate();
      return;
    }
    if (session.operation === 'update') {
      await submitUpdate();
      return;
    }
    await submitAction(session.operation);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        width: 920, maxWidth: '95vw', maxHeight: '88vh', overflow: 'auto',
        background: '#fff', border: '3px solid #0f172a', boxShadow: '6px 6px 0 #0f172a', padding: 16
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong>AGENTHUB AGENTS</strong>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        {snapshot === null && <div>AGENTHUB STATE UNAVAILABLE</div>}
        {!mutationsUsable && <div>Agent mutations are disabled until AgentHub is usable.</div>}
        {syncWarning && <div style={{ color: '#ca8a04', marginBottom: 8 }}>{syncWarning}</div>}
        {ambiguous && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>AGENT MUTATION OUTCOME UNKNOWN</div>
            <div>{session?.error?.code}: {session?.error?.message}</div>
            <button type="button" onClick={() => { void retrySame(); }} disabled={!mutationsUsable || submitting}>
              Retry Same Mutation
            </button>
            {session?.error?.code?.includes('RECONCILIATION') && (
              <div>Refresh or restart AgentHub before another Agent mutation.</div>
            )}
          </div>
        )}
        {session?.status === 'failed' && (
          <div style={{ color: '#e11d48', marginBottom: 8 }}>
            {session.error?.code}: {session.error?.message}
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
                beginCreate();
                setMode('create');
                setForm(emptyAgentFormValue());
                setConfirmKind(null);
              }}
            >
              Create Agent
            </button>
          </div>
          <div>
            {mode === 'create' && (
              <>
                <AgentHubAgentForm mode="create" value={form} projects={projects} disabled={formDisabled || ambiguous} onChange={changeForm} />
                {confirmKind === 'create' ? (
                  <div style={{ marginTop: 12 }}>
                    <div>Name: {form.name}</div>
                    <div>Provider: {form.providerId}</div>
                    <div>Model: {form.modelId}</div>
                    <div>Scope: {form.projectId ?? 'Global'}</div>
                    <div>Enabled: {String(form.enabled)}</div>
                    <button type="button" disabled={!mutationsUsable || submitting || ambiguous} onClick={() => { void submitCreate(); }}>
                      Confirm Create
                    </button>
                  </div>
                ) : (
                  <button type="button" disabled={!mutationsUsable || submitting || ambiguous} onClick={() => setConfirmKind('create')}>
                    Review Create
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
                  {!providerSupported(selected.providerId) && (
                    <div style={{ color: '#ea580c', fontWeight: 700 }}>Runtime provider unavailable</div>
                  )}
                </div>
                {mode === 'edit' ? (
                  <>
                    <AgentHubAgentForm mode="edit" value={form} projects={projects} disabled={formDisabled || ambiguous || busy} onChange={changeForm} />
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
                    <button type="button" disabled={busy || !mutationsUsable} onClick={() => { setMode('edit'); setForm(formFromAgent(selected)); }}>
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={!mutationsUsable || submitting || (selected.enabled && !providerSupported(selected.providerId))}
                      onClick={() => { void submitAction('enable'); }}
                    >
                      Enable
                    </button>
                    {confirmKind === 'disable' ? (
                      <div>
                        Disabling removes this Agent from future scheduling. It does not delete Agent history.
                        <button type="button" disabled={busy || submitting} onClick={() => { void submitAction('disable'); }}>Confirm Disable</button>
                      </div>
                    ) : (
                      <button type="button" disabled={busy || !mutationsUsable} onClick={() => setConfirmKind('disable')}>Disable</button>
                    )}
                    {confirmKind === 'delete' ? (
                      <div>
                        Only Agents with no Assignment history can be deleted. Use Disable for Agents that have history.
                        <button type="button" disabled={busy || submitting} onClick={() => { void submitAction('delete'); }}>Confirm Delete</button>
                      </div>
                    ) : (
                      <button type="button" disabled={busy || !mutationsUsable} onClick={() => setConfirmKind('delete')}>Delete</button>
                    )}
                  </div>
                )}
              </>
            )}
            {mode !== 'create' && !selected && <div>Select an Agent or create one.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
