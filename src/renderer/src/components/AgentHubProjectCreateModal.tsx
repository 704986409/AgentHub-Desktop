import React, { useState } from 'react';
import { useAgentHubStore } from '../stores/agentHubStore';
import { TaskSubmissionIdLifecycle, InvalidSubmissionTransitionError } from '@shared/agenthubSubmissionLifecycle';

const INK = 'var(--cth-ink-900, #0f172a)';

interface AgentHubProjectCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AgentHubProjectCreateModal({ isOpen, onClose }: AgentHubProjectCreateModalProps): React.ReactElement | null {
  const { connection, createProject } = useAgentHubStore();
  const lifecycleRef = React.useRef(new TaskSubmissionIdLifecycle());
  const [mutationId, setMutationId] = useState(lifecycleRef.current.id);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'applied' | 'ambiguous' | 'failed'>('idle');
  const [created, setCreated] = useState<{ projectId: string; name: string } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<{ name: string; description: string | null } | null>(null);

  if (!isOpen) return null;

  const normalized = { name: name.trim(), description: description.trim().length === 0 ? null : description };
  const mutationsBlocked = connection === 'disconnected';

  const onFieldChange = (apply: (value: string) => void, value: string): void => {
    if (status === 'submitting') return;
    if (status === 'applied' || status === 'ambiguous' || status === 'failed') {
      setMutationId(lifecycleRef.current.onEdit());
      setStatus('idle');
      setCreated(null);
      setWarning(null);
      setErrorMessage(null);
    }
    apply(value);
  };

  const submit = async (retry: boolean): Promise<void> => {
    const id = retry ? lifecycleRef.current.beginRetry() : lifecycleRef.current.beginSubmit();
    setMutationId(id);
    setStatus('submitting');
    setErrorMessage(null);
    const input = retry && lastInput ? lastInput : { name: name.trim(), description: description.trim().length === 0 ? null : description };
    setLastInput(input);
    const result = await createProject({ mutationId: id, input });
    lifecycleRef.current.onResult(result.status);
    setMutationId(lifecycleRef.current.id);
    setStatus(result.status);
    if (result.status === 'applied') {
      setCreated({ projectId: result.project.projectId, name: result.project.name });
      setWarning(result.stateSynchronized ? null : result.warning.message);
      setErrorMessage(null);
      return;
    }
    setCreated(null);
    setWarning(null);
    setErrorMessage(result.error.message);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 420, background: '#fff', border: `2px solid ${INK}`, padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Create Project</div>
        <label style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>
          Name *
          <input
            value={name}
            disabled={status === 'submitting'}
            onChange={(event) => onFieldChange(setName, event.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          />
        </label>
        <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginTop: 10 }}>
          Description
          <textarea
            value={description}
            disabled={status === 'submitting'}
            onChange={(event) => onFieldChange(setDescription, event.target.value)}
            rows={3}
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          />
        </label>
        {status === 'applied' && created && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <div>Project created</div>
            <div>Name: {created.name}</div>
            <div>Project ID: {created.projectId}</div>
            {warning && (
              <div>
                Project created on Backend. State refresh failed. Use Refresh before creating another Project.
              </div>
            )}
          </div>
        )}
        {status === 'ambiguous' && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            Outcome is unknown. The Backend may already have created this Project.
          </div>
        )}
        {errorMessage && status === 'failed' && <div style={{ marginTop: 12, fontSize: 13 }}>{errorMessage}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onClose}>Close</button>
          {status === 'ambiguous' && (
            <button type="button" onClick={() => { void submit(true).catch((error: unknown) => {
              if (error instanceof InvalidSubmissionTransitionError) setErrorMessage(error.message);
            }); }}>
              Retry same mutation
            </button>
          )}
          <button
            type="button"
            disabled={status === 'submitting' || status === 'ambiguous' || mutationsBlocked || normalized.name.length === 0}
            onClick={() => { void submit(false).catch((error: unknown) => {
              if (error instanceof InvalidSubmissionTransitionError) setErrorMessage(error.message);
            }); }}
          >
            Create Project
          </button>
        </div>
        <div style={{ display: 'none' }}>{mutationId}</div>
      </div>
    </div>
  );
}
