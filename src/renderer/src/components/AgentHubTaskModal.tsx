import React, { useState, useEffect } from 'react';
import { useAgentHubStore } from '../stores/agentHubStore';
import {
  TASK_COMPLEXITIES,
  TASK_RISKS,
  snapshotCreateTaskInput,
  type TaskComplexity,
  type TaskRisk,
  type CreateTaskInputDto
} from '@shared/agenthubTypes';

interface AgentHubTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AgentHubTaskModal({ isOpen, onClose }: AgentHubTaskModalProps): React.ReactElement | null {
  const { snapshot, connection, submitTask } = useAgentHubStore();
  const projects = snapshot?.projects ?? [];

  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [complexity, setComplexity] = useState<TaskComplexity>('MEDIUM');
  const [risk, setRisk] = useState<TaskRisk>('LOW');
  const [capabilitiesRaw, setCapabilitiesRaw] = useState('');
  const [specialtiesRaw, setSpecialtiesRaw] = useState('');
  const [criteriaRaw, setCriteriaRaw] = useState('');

  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState<'idle' | 'submitting' | 'created' | 'ambiguous' | 'failed'>('idle');
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSubmittedInput, setLastSubmittedInput] = useState<CreateTaskInputDto | null>(null);

  // Initialize or default projectId when projects load
  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0].projectId);
    }
  }, [projects, projectId]);

  if (!isOpen) return null;

  const onFieldChange = <T,>(setter: (v: T) => void, val: T) => {
    if (status === 'ambiguous' || status === 'failed' || status === 'created') {
      setSubmissionId(crypto.randomUUID());
      setStatus('idle');
      setErrorMessage(null);
      setWarningMessage(null);
      setCreatedTaskId(null);
    }
    setter(val);
  };

  const parseList = (raw: string): string[] => {
    return raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  const buildInput = (): CreateTaskInputDto => {
    return {
      projectId,
      title,
      description: description.trim().length > 0 ? description : null,
      requiredCapabilities: parseList(capabilitiesRaw),
      requiredSpecialties: parseList(specialtiesRaw),
      acceptanceCriteria: criteriaRaw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0),
      complexity,
      risk
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'submitting') return;

    let input: CreateTaskInputDto;
    try {
      input = snapshotCreateTaskInput(buildInput());
    } catch (err: any) {
      setErrorMessage(err.message || 'Validation failed');
      setStatus('failed');
      return;
    }

    setStatus('submitting');
    setErrorMessage(null);
    setWarningMessage(null);
    setLastSubmittedInput(input);

    let result;
    try {
      result = await submitTask({ submissionId, input });
    } catch (err: any) {
      setStatus('failed');
      setErrorMessage(err?.message || 'Task submission failed');
      return;
    }

    if (result.status === 'created') {
      setStatus('created');
      setCreatedTaskId(result.task.taskId);
      if (!result.stateSynchronized && result.warning) {
        setWarningMessage(`Warning [${result.warning.code}]: ${result.warning.message}`);
      }
    } else if (result.status === 'ambiguous') {
      setStatus('ambiguous');
      setErrorMessage(`[${result.error.code}] ${result.error.message} (Ambiguous outcome: server may or may not have committed)`);
    } else {
      setStatus('failed');
      setErrorMessage(`[${result.error.code}] ${result.error.message}`);
    }
  };

  const handleRetry = async () => {
    if (status === 'submitting' || !lastSubmittedInput) return;
    setStatus('submitting');
    setErrorMessage(null);
    setWarningMessage(null);

    // Reuse EXACT same submissionId and normalized body
    let result;
    try {
      result = await submitTask({ submissionId, input: lastSubmittedInput });
    } catch (err: any) {
      setStatus('failed');
      setErrorMessage(err?.message || 'Task retry failed');
      return;
    }

    if (result.status === 'created') {
      setStatus('created');
      setCreatedTaskId(result.task.taskId);
      if (!result.stateSynchronized && result.warning) {
        setWarningMessage(`Warning [${result.warning.code}]: ${result.warning.message}`);
      }
    } else if (result.status === 'ambiguous') {
      setStatus('ambiguous');
      setErrorMessage(`[${result.error.code}] ${result.error.message}`);
    } else {
      setStatus('failed');
      setErrorMessage(`[${result.error.code}] ${result.error.message}`);
    }
  };

  const INK = 'var(--cth-ink-900, #0f172a)';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        fontFamily: 'var(--cth-font-ui, sans-serif)'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 520,
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: 'var(--cth-paper-100, #ffffff)',
          color: INK,
          border: `2px solid ${INK}`,
          boxShadow: `6px 6px 0 ${INK}`,
          padding: 20
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>AgentHub — Submit New Task</h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 18,
              cursor: 'pointer',
              color: INK
            }}
          >
            ✕
          </button>
        </div>

        {status === 'created' && (
          <div
            style={{
              padding: '10px 12px',
              marginBottom: 16,
              backgroundColor: 'var(--cth-mint-light, #d0f0e0)',
              border: '1px solid var(--cth-mint-dark, #16a34a)',
              color: 'var(--cth-mint-dark, #16a34a)',
              borderRadius: 2
            }}
          >
            <strong>Task Created Successfully!</strong>
            <div>Task ID: <code>{createdTaskId}</code></div>
            {warningMessage && (
              <div style={{ color: 'var(--cth-amber-dark, #ca8a04)', marginTop: 4 }}>
                {warningMessage}
              </div>
            )}
          </div>
        )}

        {errorMessage && (
          <div
            style={{
              padding: '10px 12px',
              marginBottom: 16,
              backgroundColor: status === 'ambiguous' ? 'var(--cth-amber-light, #fef3c7)' : 'var(--cth-rose-light, #ffe4e6)',
              border: `1px solid ${status === 'ambiguous' ? 'var(--cth-amber-dark, #ca8a04)' : 'var(--cth-rose-dark, #e11d48)'}`,
              color: status === 'ambiguous' ? 'var(--cth-amber-dark, #ca8a04)' : 'var(--cth-rose-dark, #e11d48)',
              borderRadius: 2,
              fontSize: 13
            }}
          >
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Project selector */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Project *
            </label>
            {projects.length > 0 ? (
              <select
                value={projectId}
                onChange={(e) => onFieldChange(setProjectId, e.target.value)}
                disabled={status === 'submitting'}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: `1px solid ${INK}`,
                  fontFamily: 'inherit',
                  fontSize: 13
                }}
              >
                {projects.map((p) => (
                  <option key={p.projectId} value={p.projectId}>
                    {p.name} ({p.projectId})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={projectId}
                onChange={(e) => onFieldChange(setProjectId, e.target.value)}
                placeholder="No projects loaded from snapshot"
                disabled={status === 'submitting'}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: `1px solid ${INK}`,
                  fontFamily: 'inherit',
                  fontSize: 13
                }}
              />
            )}
          </div>

          {/* Title */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => onFieldChange(setTitle, e.target.value)}
              placeholder="e.g. Implement authentication endpoint"
              disabled={status === 'submitting'}
              required
              style={{
                width: '100%',
                padding: '6px 8px',
                border: `1px solid ${INK}`,
                fontFamily: 'inherit',
                fontSize: 13
              }}
            />
          </div>

          {/* Description */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => onFieldChange(setDescription, e.target.value)}
              placeholder="Detailed task description..."
              rows={3}
              disabled={status === 'submitting'}
              style={{
                width: '100%',
                padding: '6px 8px',
                border: `1px solid ${INK}`,
                fontFamily: 'inherit',
                fontSize: 13,
                resize: 'vertical'
              }}
            />
          </div>

          {/* Complexity and Risk */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Complexity
              </label>
              <select
                value={complexity}
                onChange={(e) => onFieldChange(setComplexity, e.target.value as TaskComplexity)}
                disabled={status === 'submitting'}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: `1px solid ${INK}`,
                  fontFamily: 'inherit',
                  fontSize: 13
                }}
              >
                {TASK_COMPLEXITIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Risk
              </label>
              <select
                value={risk}
                onChange={(e) => onFieldChange(setRisk, e.target.value as TaskRisk)}
                disabled={status === 'submitting'}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: `1px solid ${INK}`,
                  fontFamily: 'inherit',
                  fontSize: 13
                }}
              >
                {TASK_RISKS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Required Capabilities */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Required Capabilities (comma or line separated)
            </label>
            <input
              type="text"
              value={capabilitiesRaw}
              onChange={(e) => onFieldChange(setCapabilitiesRaw, e.target.value)}
              placeholder="e.g. typescript, nodejs"
              disabled={status === 'submitting'}
              style={{
                width: '100%',
                padding: '6px 8px',
                border: `1px solid ${INK}`,
                fontFamily: 'inherit',
                fontSize: 13
              }}
            />
          </div>

          {/* Required Specialties */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Required Specialties (comma or line separated)
            </label>
            <input
              type="text"
              value={specialtiesRaw}
              onChange={(e) => onFieldChange(setSpecialtiesRaw, e.target.value)}
              placeholder="e.g. backend, security"
              disabled={status === 'submitting'}
              style={{
                width: '100%',
                padding: '6px 8px',
                border: `1px solid ${INK}`,
                fontFamily: 'inherit',
                fontSize: 13
              }}
            />
          </div>

          {/* Acceptance Criteria */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Acceptance Criteria (one per line)
            </label>
            <textarea
              value={criteriaRaw}
              onChange={(e) => onFieldChange(setCriteriaRaw, e.target.value)}
              placeholder="e.g. Endpoint passes all unit tests"
              rows={2}
              disabled={status === 'submitting'}
              style={{
                width: '100%',
                padding: '6px 8px',
                border: `1px solid ${INK}`,
                fontFamily: 'inherit',
                fontSize: 13,
                resize: 'vertical'
              }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={status === 'submitting'}
              style={{
                padding: '6px 14px',
                border: `1px solid ${INK}`,
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 13
              }}
            >
              Cancel
            </button>

            {status === 'ambiguous' && (
              <button
                type="button"
                onClick={handleRetry}
                style={{
                  padding: '6px 14px',
                  border: `1px solid ${INK}`,
                  background: 'var(--cth-amber-light, #fef3c7)',
                  color: 'var(--cth-amber-dark, #ca8a04)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 13
                }}
              >
                Retry Same Submission
              </button>
            )}

            <button
              type="submit"
              disabled={status === 'submitting' || connection === 'disconnected' || !title.trim()}
              style={{
                padding: '6px 14px',
                border: `2px solid ${INK}`,
                background: status === 'submitting' ? 'var(--cth-ink-300, #cbd5e1)' : 'var(--cth-mint-dark, #16a34a)',
                color: '#ffffff',
                cursor: status === 'submitting' || !title.trim() ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: 13,
                boxShadow: `2px 2px 0 ${INK}`
              }}
            >
              {status === 'submitting' ? 'Submitting...' : 'Submit Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
