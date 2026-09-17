import React, { useEffect, useState } from 'react';
import { useAgentHubStore } from '../stores/agentHubStore';
import type { ExecuteTaskInputDto, ExecuteTaskResultDto, TaskDto } from '@shared/agenthubTypes';
import { TaskExecutionIdLifecycle } from '@shared/agenthubExecutionLifecycle';

interface AgentHubExecuteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatTaskLabel(task: TaskDto): string {
  return `${task.title} (${task.taskId} · ${task.status})`;
}

function executionOutcomeSummary(result: ExecuteTaskResultDto): React.ReactElement {
  if (result.outcome === 'review-ready') {
    return (
      <>
        <strong>Review Ready</strong>
        <div>Task ID: <code>{result.taskId}</code></div>
        <div>Assignment ID: <code>{result.assignmentId}</code></div>
        <div>Agent ID: <code>{result.agentId}</code></div>
        <div>Provider ID: <code>{result.providerId}</code></div>
        <div>Review handle: <code>{result.reviewHandle}</code></div>
        <div>Worker summary: {result.workerResult.summary}</div>
        <div>
          Blockers {result.workerResult.blockers.length}
          {' · '}Questions {result.workerResult.questions.length}
          {' · '}Risks {result.workerResult.risks.length}
          {' · '}Notes {result.workerResult.notes.length}
        </div>
        <div>
          Build {result.buildTest.build}
          {' · '}Test {result.buildTest.test}
          {' · '}Evidence {result.buildTest.outcome}
        </div>
        <div>Changed paths: {result.source.changedPaths.length === 0 ? '(none)' : result.source.changedPaths.join(', ')}</div>
      </>
    );
  }

  return (
    <>
      <strong>AgentHub returned {result.outcome}</strong>
      <div>Task ID: <code>{result.taskId}</code></div>
      <div>Assignment ID: <code>{result.assignmentId}</code></div>
    </>
  );
}

export function AgentHubExecuteModal({ isOpen, onClose }: AgentHubExecuteModalProps): React.ReactElement | null {
  const { snapshot, connection, executeTask } = useAgentHubStore();
  const tasks = snapshot?.tasks ?? [];

  const [taskId, setTaskId] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [prompt, setPrompt] = useState('');

  const lifecycleRef = React.useRef(new TaskExecutionIdLifecycle());
  const [executionId, setExecutionId] = useState(lifecycleRef.current.id);
  const [status, setStatus] = useState<'idle' | 'executing' | 'executed' | 'ambiguous' | 'failed'>('idle');
  const [executeResult, setExecuteResult] = useState<ExecuteTaskResultDto | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastExecutedInput, setLastExecutedInput] = useState<{ taskId: string; input: ExecuteTaskInputDto } | null>(null);

  useEffect(() => {
    if (!taskId && tasks.length > 0) {
      setTaskId(tasks[0].taskId);
    }
  }, [tasks, taskId]);

  if (!isOpen) return null;

  const onFieldChange = <T,>(setter: (v: T) => void, val: T) => {
    if (status === 'ambiguous' || status === 'failed' || status === 'executed') {
      lifecycleRef.current.onEdit();
      setExecutionId(lifecycleRef.current.id);
      setStatus('idle');
      setErrorMessage(null);
      setWarningMessage(null);
      setExecuteResult(null);
    }
    setter(val);
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'executing' || status === 'ambiguous') return;
    if (!tasks.some((task) => task.taskId === taskId)) return;

    const input: ExecuteTaskInputDto = { baseRef, prompt };
    let id: string;
    try {
      id = lifecycleRef.current.beginExecute();
    } catch {
      return;
    }
    setExecutionId(id);
    setStatus('executing');
    setErrorMessage(null);
    setWarningMessage(null);
    setExecuteResult(null);
    setLastExecutedInput({ taskId, input });

    let result;
    try {
      result = await executeTask({
        executionId: id,
        taskId,
        input
      });
    } catch (err: any) {
      lifecycleRef.current.onResult('ambiguous');
      setExecutionId(lifecycleRef.current.id);
      setStatus('ambiguous');
      setErrorMessage(err?.message || 'Task execution outcome is unknown');
      return;
    }

    if (result.status === 'executed') {
      lifecycleRef.current.onResult('executed');
      setExecutionId(lifecycleRef.current.id);
      setStatus('executed');
      setExecuteResult(result.result);
      if (!result.stateSynchronized && result.warning) {
        setWarningMessage(`Warning [${result.warning.code}]: ${result.warning.message}`);
      }
    } else if (result.status === 'ambiguous') {
      lifecycleRef.current.onResult('ambiguous');
      setExecutionId(lifecycleRef.current.id);
      setStatus('ambiguous');
      setErrorMessage(
        `Outcome unknown. Server may have committed execution. [${result.error.code}] ${result.error.message}`
      );
    } else {
      lifecycleRef.current.onResult('failed');
      setExecutionId(lifecycleRef.current.id);
      setStatus('failed');
      setErrorMessage(`[${result.error.code}] ${result.error.message}`);
    }
  };

  const handleRetry = async () => {
    if (status !== 'ambiguous' || !lastExecutedInput) return;

    let id: string;
    try {
      id = lifecycleRef.current.beginRetry();
    } catch {
      return;
    }
    setExecutionId(id);
    setStatus('executing');
    setErrorMessage(null);
    setWarningMessage(null);

    let result;
    try {
      result = await executeTask({
        executionId: id,
        taskId: lastExecutedInput.taskId,
        input: lastExecutedInput.input
      });
    } catch (err: any) {
      lifecycleRef.current.onResult('ambiguous');
      setExecutionId(lifecycleRef.current.id);
      setStatus('ambiguous');
      setErrorMessage(err?.message || 'Task execution retry outcome is unknown');
      return;
    }

    if (result.status === 'executed') {
      lifecycleRef.current.onResult('executed');
      setExecutionId(lifecycleRef.current.id);
      setStatus('executed');
      setExecuteResult(result.result);
      if (!result.stateSynchronized && result.warning) {
        setWarningMessage(`Warning [${result.warning.code}]: ${result.warning.message}`);
      }
    } else if (result.status === 'ambiguous') {
      lifecycleRef.current.onResult('ambiguous');
      setExecutionId(lifecycleRef.current.id);
      setStatus('ambiguous');
      setErrorMessage(
        `Outcome unknown. Server may have committed execution. [${result.error.code}] ${result.error.message}`
      );
    } else {
      lifecycleRef.current.onResult('failed');
      setExecutionId(lifecycleRef.current.id);
      setStatus('failed');
      setErrorMessage(`[${result.error.code}] ${result.error.message}`);
    }
  };

  const INK = 'var(--cth-ink-900, #0f172a)';
  const selectedTaskInSnapshot = tasks.some((task) => task.taskId === taskId);
  const canSubmit =
    connection !== 'disconnected' &&
    selectedTaskInSnapshot &&
    status !== 'executing' &&
    status !== 'ambiguous';

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
          width: 560,
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
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>AgentHub — Execute Task</h2>
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

        {status === 'executed' && executeResult && (
          <div
            style={{
              padding: '10px 12px',
              marginBottom: 16,
              backgroundColor: executeResult.outcome === 'failed' ? 'var(--cth-rose-light, #ffe4e6)' : 'var(--cth-mint-light, #d0f0e0)',
              border: `1px solid ${executeResult.outcome === 'failed' ? 'var(--cth-rose-dark, #e11d48)' : 'var(--cth-mint-dark, #16a34a)'}`,
              color: executeResult.outcome === 'failed' ? 'var(--cth-rose-dark, #e11d48)' : 'var(--cth-mint-dark, #16a34a)',
              borderRadius: 2,
              fontSize: 13,
              lineHeight: 1.5
            }}
          >
            {executionOutcomeSummary(executeResult)}
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

        <form onSubmit={handleExecute}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Task *
            </label>
            {tasks.length > 0 ? (
              <select
                value={selectedTaskInSnapshot ? taskId : ''}
                onChange={(e) => onFieldChange(setTaskId, e.target.value)}
                disabled={status === 'executing'}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: `1px solid ${INK}`,
                  fontFamily: 'inherit'
                }}
              >
                {!selectedTaskInSnapshot && (
                  <option value="" disabled>
                    Select an authoritative task
                  </option>
                )}
                {tasks.map((task) => (
                  <option key={task.taskId} value={task.taskId}>
                    {formatTaskLabel(task)}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--cth-ink-500, #64748b)' }}>
                No authoritative tasks are available. Refresh AgentHub state first.
              </div>
            )}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Base Ref *
            </label>
            <input
              type="text"
              value={baseRef}
              placeholder="main"
              onChange={(e) => onFieldChange(setBaseRef, e.target.value)}
              disabled={status === 'executing'}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '6px 8px',
                border: `1px solid ${INK}`,
                fontFamily: 'var(--cth-font-mono, monospace)'
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Prompt *
            </label>
            <textarea
              value={prompt}
              onChange={(e) => onFieldChange(setPrompt, e.target.value)}
              disabled={status === 'executing'}
              rows={8}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '6px 8px',
                border: `1px solid ${INK}`,
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: canSubmit ? 'var(--cth-mint-light, #d0f0e0)' : 'var(--cth-ink-200, #e2e8f0)',
                border: `1px solid ${canSubmit ? 'var(--cth-mint-dark, #16a34a)' : 'var(--cth-ink-400, #94a3b8)'}`,
                color: canSubmit ? 'var(--cth-mint-dark, #16a34a)' : 'var(--cth-ink-500, #64748b)',
                fontWeight: 700,
                cursor: canSubmit ? 'pointer' : 'not-allowed'
              }}
            >
              {status === 'executing' ? 'Executing…' : 'Execute'}
            </button>
            {status === 'ambiguous' && (
              <button
                type="button"
                onClick={() => { void handleRetry(); }}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: 'var(--cth-amber-light, #fef3c7)',
                  border: '1px solid var(--cth-amber-dark, #ca8a04)',
                  color: 'var(--cth-amber-dark, #ca8a04)',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Retry Same Execution
              </button>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--cth-ink-500, #64748b)' }}>
            Execution ID {executionId} is owned by Desktop. AgentHub remains the scheduler and worker authority.
          </div>
        </form>
      </div>
    </div>
  );
}
