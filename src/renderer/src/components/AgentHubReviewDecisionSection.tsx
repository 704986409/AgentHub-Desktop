import React, { useEffect, useMemo, useState } from 'react';
import type {
  ReviewVerdictDto,
  ReviewFindingSeverityDto,
  ReviewFindingInputDto,
  MergeGateReasonDto
} from '@shared/agenthubTypes';
import {
  REVIEW_VERDICTS,
  REVIEW_FINDING_SEVERITIES
} from '@shared/agenthubTypes';
import { useAgentHubReviewActionStore } from '../stores/agentHubReviewActionStore';
import { useAgentHubStore } from '../stores/agentHubStore';
import { validateReviewDecisionInput } from './agentHubReviewActionValidation';

interface AgentHubReviewDecisionSectionProps {
  taskId: string;
  reviewHandle: string;
  stateSynchronized: boolean;
}

const INK = 'var(--cth-ink-900, #0f172a)';
const BORDER = '1px solid var(--cth-ink-300, #cbd5e1)';
const BG_MUTED = 'var(--cth-paper-200, #f8fafc)';

const MERGE_GATE_DESCRIPTIONS: Record<string, string> = {
  STALE_SOURCE: 'The reviewed source no longer matches the current task source.',
  TARGET_DIVERGED: 'The target branch has diverged since review began.',
  BRANCH_COLLISION: 'A branch collision was detected on the target branch.',
  HOOK_FAILED: 'A pre-merge validation hook failed.',
  WORKING_COPY_DIRTY: 'The target working copy has uncommitted changes.',
  MERGE_GATE_TIMEOUT: 'Merge gate evaluation timed out.',
  SYSTEM_ABORTED: 'Merge gate evaluation was aborted by the system.',
  CONFLICTS: 'Merge conflicts detected between task branch and target branch.',
  NO_COMMITTED_CHANGES: 'Task contains no committed changes eligible for merge.'
};

export function AgentHubReviewDecisionSection({
  taskId,
  reviewHandle,
  stateSynchronized: _initialSyncState
}: AgentHubReviewDecisionSectionProps) {
  const session = useAgentHubReviewActionStore((s) => s.sessionsByTaskId[taskId]);
  const isHandleUnavailable = useAgentHubReviewActionStore((s) =>
    s.isHandleUnavailable(reviewHandle)
  );
  const getOrCreateSession = useAgentHubReviewActionStore(
    (s) => s.getOrCreateSession
  );
  const updateDraftInput = useAgentHubReviewActionStore(
    (s) => s.updateDraftInput
  );
  const setSubmitting = useAgentHubReviewActionStore((s) => s.setSubmitting);
  const setApplied = useAgentHubReviewActionStore((s) => s.setApplied);
  const setFailed = useAgentHubReviewActionStore((s) => s.setFailed);
  const setAmbiguous = useAgentHubReviewActionStore((s) => s.setAmbiguous);

  const reviewDecision = useAgentHubStore((s) => s.reviewDecision);

  useEffect(() => {
    getOrCreateSession(taskId, reviewHandle);
  }, [taskId, reviewHandle, getOrCreateSession]);

  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const input = session?.input;
  const isPending = session?.status === 'submitting';

  const validationError = useMemo(() => {
    if (!input) return null;
    return validateReviewDecisionInput(input);
  }, [input]);

  if (!session || !input) {
    return null;
  }

  const isValid = validationError === null;
  const canSubmit = isValid && !isPending && !isHandleUnavailable;

  const handleAddFinding = () => {
    const newFinding: ReviewFindingInputDto = {
      code: '',
      severity: 'info',
      message: '',
      path: ''
    };
    updateDraftInput(taskId, {
      findings: [...input.findings, newFinding]
    });
  };

  const handleRemoveFinding = (index: number) => {
    updateDraftInput(taskId, {
      findings: input.findings.filter((_, i) => i !== index)
    });
  };

  const handleUpdateFinding = (
    index: number,
    patch: Partial<ReviewFindingInputDto>
  ) => {
    const updated = input.findings.map((item, i) =>
      i === index ? { ...item, ...patch } : item
    );
    updateDraftInput(taskId, {
      findings: updated
    });
  };

  const handleExecuteDecision = async () => {
    setShowConfirmModal(false);
    setSubmitting(taskId);
    try {
      const res = await reviewDecision({
        decisionId: session.decisionId,
        reviewHandle: session.reviewHandle,
        input: session.input
      });

      if (res.status === 'applied') {
        const warning = !res.stateSynchronized ? res.warning : null;
        setApplied(taskId, res.result, res.stateSynchronized, warning);
        if (res.result.outcome === 'review-ready') {
          getOrCreateSession(taskId, res.result.reviewHandle);
        }
      } else if (res.status === 'failed') {
        setFailed(taskId, res.error);
      } else if (res.status === 'ambiguous') {
        setAmbiguous(taskId, res.error);
      }
    } catch (err: unknown) {
      setAmbiguous(taskId, {
        code: 'CLIENT_EXECUTION_ERROR',
        message:
          (err as Error)?.message ||
          'Unexpected failure executing review decision'
      });
    }
  };

  const getConfirmationCopy = () => {
    switch (input.verdict) {
      case 'ACCEPT':
        return {
          title: 'Confirm Accept',
          message:
            'Accepting this review may complete the task and, if the merge gate passes, merge its committed changes into the configured target branch immediately.',
          confirmText: 'Confirm Accept'
        };
      case 'REQUEST_REVISION':
        return {
          title: 'Confirm Revision',
          message:
            'Requesting revision may immediately run the assigned Agent again, consume provider/model usage, modify its task workspace, run build/test commands, and return new review evidence.',
          confirmText: 'Confirm Revision'
        };
      case 'BLOCK':
        return {
          title: 'Confirm Block',
          message:
            'Blocking will fail the current task lifecycle and shut down the current Agent execution for this assignment.',
          confirmText: 'Confirm Block'
        };
    }
  };

  const confirmCopy = getConfirmationCopy();

  return (
    <div
      style={{
        marginTop: 20,
        paddingTop: 16,
        borderTop: `2px solid ${INK}`
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
          Human Decision
        </h3>
        <span
          style={{
            fontSize: 11,
            color: 'var(--cth-ink-500, #64748b)',
            fontFamily: 'monospace'
          }}
        >
          decisionId: {session.decisionId.slice(0, 8)}...
        </span>
      </div>

      {/* Handle Unavailable Banner */}
      {isHandleUnavailable && (
        <div
          style={{
            padding: '10px 14px',
            marginBottom: 16,
            backgroundColor: 'var(--cth-ink-100, #f1f5f9)',
            border: BORDER,
            borderRadius: 2,
            fontSize: 12,
            color: 'var(--cth-ink-700, #334155)'
          }}
        >
          <strong>Review Handle Inactive:</strong> This review handle is no
          longer active for submission (already completed, expired, or failed).
          Evidence remains inspectable.
        </div>
      )}

      {/* Applied Result Outcomes */}
      {session.status === 'applied' && session.result && (
        <div style={{ marginBottom: 16 }}>
          {session.result.outcome === 'review-ready' && (
            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'var(--cth-blue-light, #eff6ff)',
                border: '1px solid var(--cth-blue-dark, #2563eb)',
                color: 'var(--cth-blue-dark, #1d4ed8)',
                fontSize: 12,
                borderRadius: 2
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                REVISION COMPLETE · NEW REVIEW EVIDENCE READY
              </div>
              <div>
                The assigned agent completed revision. The review panel has
                updated with new evidence and a new handle.
              </div>
            </div>
          )}

          {session.result.outcome === 'completed' && (
            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'var(--cth-emerald-light, #ecfdf5)',
                border: '1px solid var(--cth-emerald-dark, #059669)',
                color: 'var(--cth-emerald-dark, #047857)',
                fontSize: 12,
                borderRadius: 2
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                TASK COMPLETED · MERGED
              </div>
              {'merge' in session.result && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    gap: '4px 12px',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    marginTop: 8
                  }}
                >
                  <span style={{ fontWeight: 600 }}>targetBranch:</span>
                  <span>{session.result.merge.targetBranch}</span>
                  <span style={{ fontWeight: 600 }}>targetHeadBefore:</span>
                  <span>{session.result.merge.targetHeadBefore}</span>
                  <span style={{ fontWeight: 600 }}>targetHeadAfter:</span>
                  <span>{session.result.merge.targetHeadAfter}</span>
                  <span style={{ fontWeight: 600 }}>outcome:</span>
                  <span>{session.result.merge.outcome}</span>
                  <span style={{ fontWeight: 600 }}>mergeResultSha256:</span>
                  <span>{session.result.merge.mergeResultSha256}</span>
                </div>
              )}
            </div>
          )}

          {session.result.outcome === 'completed-no-change' && (
            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'var(--cth-emerald-light, #ecfdf5)',
                border: '1px solid var(--cth-emerald-dark, #059669)',
                color: 'var(--cth-emerald-dark, #047857)',
                fontSize: 12,
                borderRadius: 2
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                TASK COMPLETED · NO MERGE REQUIRED
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: '4px 12px',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  marginTop: 8
                }}
              >
                <span style={{ fontWeight: 600 }}>reviewEvidenceSha256:</span>
                <span>{session.result.reviewEvidenceSha256}</span>
                <span style={{ fontWeight: 600 }}>lifecycleSha256:</span>
                <span>{session.result.lifecycleSha256}</span>
              </div>
            </div>
          )}

          {session.result.outcome === 'merge-denied' && (
            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'var(--cth-amber-light, #fef3c7)',
                border: '1px solid var(--cth-amber-dark, #d97706)',
                color: 'var(--cth-amber-dark, #b45309)',
                fontSize: 12,
                borderRadius: 2
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                MERGE DENIED
              </div>
              <div style={{ marginTop: 4 }}>
                <strong>REASONS:</strong>
                {session.result.mergeGate.reasons.map((r: MergeGateReasonDto, i: number) => (
                  <div key={i} style={{ marginLeft: 8, marginTop: 2 }}>
                    • <code>{r}</code>
                    {MERGE_GATE_DESCRIPTIONS[r] && (
                      <span> — {MERGE_GATE_DESCRIPTIONS[r]}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(session.result.outcome === 'failed' ||
            session.result.outcome === 'blocked' ||
            session.result.outcome === 'waiting-input') && (
            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'var(--cth-rose-light, #ffe4e6)',
                border: '1px solid var(--cth-rose-dark, #e11d48)',
                color: 'var(--cth-rose-dark, #be123c)',
                fontSize: 12,
                borderRadius: 2
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                TASK LIFECYCLE: {session.result.outcome.toUpperCase()}
              </div>
              <div>
                Backend lifecycle returned outcome <code>{session.result.outcome}</code>.
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: '4px 12px',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  marginTop: 6
                }}
              >
                <span style={{ fontWeight: 600 }}>reviewEvidenceSha256:</span>
                <span>{session.result.reviewEvidenceSha256}</span>
                <span style={{ fontWeight: 600 }}>lifecycleSha256:</span>
                <span>{session.result.lifecycleSha256}</span>
              </div>
            </div>
          )}

          {/* State Resync Warning */}
          {session.stateSynchronized === false && session.warning && (
            <div
              style={{
                padding: '8px 12px',
                marginTop: 8,
                backgroundColor: 'var(--cth-amber-light, #fef3c7)',
                border: '1px solid var(--cth-amber-dark, #ca8a04)',
                color: 'var(--cth-amber-dark, #ca8a04)',
                fontSize: 12,
                borderRadius: 2
              }}
            >
              <strong>State Sync Warning:</strong> Decision was confirmed by
              AgentHub, but Desktop could not refresh authoritative state.
            </div>
          )}
        </div>
      )}

      {/* Definitive Failure Banner */}
      {session.status === 'failed' && session.error && (
        <div
          style={{
            padding: '12px 14px',
            marginBottom: 16,
            backgroundColor: 'var(--cth-rose-light, #ffe4e6)',
            border: '1px solid var(--cth-rose-dark, #e11d48)',
            color: 'var(--cth-rose-dark, #be123c)',
            fontSize: 12,
            borderRadius: 2
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
            DECISION NOT APPLIED BY THIS REQUEST
          </div>
          <div>
            <strong>Code:</strong> <code>{session.error.code}</code>
          </div>
          <div>
            <strong>Message:</strong> {session.error.message}
          </div>
        </div>
      )}

      {/* Ambiguous Banner */}
      {session.status === 'ambiguous' && session.error && (
        <div
          style={{
            padding: '12px 14px',
            marginBottom: 16,
            backgroundColor: 'var(--cth-amber-light, #fef3c7)',
            border: '1px solid var(--cth-amber-dark, #d97706)',
            color: 'var(--cth-amber-dark, #b45309)',
            fontSize: 12,
            borderRadius: 2
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
            DECISION OUTCOME UNKNOWN
          </div>
          <div style={{ marginBottom: 6 }}>
            The outcome could not be determined due to a network or response
            issue. The decision may or may not have been applied by the server.
          </div>
          <div>
            <strong>Code:</strong> <code>{session.error.code}</code>
          </div>
          <div>
            <strong>Message:</strong> {session.error.message}
          </div>
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              disabled={isPending || isHandleUnavailable}
              onClick={handleExecuteDecision}
              style={{
                padding: '6px 14px',
                backgroundColor: 'var(--cth-amber-dark, #d97706)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                borderRadius: 2
              }}
            >
              {isPending ? 'Retrying...' : 'Retry Same Decision'}
            </button>
          </div>
        </div>
      )}

      {/* Form Fields */}
      <div style={{ opacity: isHandleUnavailable ? 0.6 : 1 }}>
        {/* Verdict Selection */}
        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              display: 'block',
              fontWeight: 600,
              fontSize: 12,
              marginBottom: 6
            }}
          >
            Verdict
          </label>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {REVIEW_VERDICTS.map((v: ReviewVerdictDto) => (
              <label
                key={v}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: input.verdict === v ? 600 : 400,
                  cursor: isHandleUnavailable ? 'not-allowed' : 'pointer'
                }}
              >
                <input
                  type="radio"
                  name={`verdict-${taskId}`}
                  value={v}
                  checked={input.verdict === v}
                  disabled={isHandleUnavailable || isPending}
                  onChange={() => updateDraftInput(taskId, { verdict: v })}
                />
                {v}
              </label>
            ))}
          </div>
        </div>

        {/* Summary Field */}
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 4
            }}
          >
            <label style={{ fontWeight: 600, fontSize: 12 }}>Summary</label>
            <span
              style={{
                fontSize: 11,
                color:
                  input.summary.length > 4000
                    ? 'var(--cth-rose-dark, #e11d48)'
                    : 'var(--cth-ink-500, #64748b)'
              }}
            >
              {input.summary.length} / 4000
            </span>
          </div>
          <textarea
            rows={3}
            value={input.summary}
            disabled={isHandleUnavailable || isPending}
            onChange={(e) =>
              updateDraftInput(taskId, { summary: e.target.value })
            }
            placeholder="Enter review decision summary..."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '6px 8px',
              fontSize: 12,
              border: BORDER,
              fontFamily: 'inherit',
              backgroundColor: 'var(--cth-paper-100, #ffffff)'
            }}
          />
        </div>

        {/* Allow No-Change Completion */}
        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              cursor: isHandleUnavailable ? 'not-allowed' : 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={input.allowNoChangeCompletion}
              disabled={isHandleUnavailable || isPending}
              onChange={(e) =>
                updateDraftInput(taskId, {
                  allowNoChangeCompletion: e.target.checked
                })
              }
            />
            Allow no-change completion (complete task even if diff is empty)
          </label>
        </div>

        {/* Findings Editor */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8
            }}
          >
            <label style={{ fontWeight: 600, fontSize: 12 }}>
              Findings ({input.findings.length} / 50)
            </label>
            <button
              type="button"
              disabled={
                isHandleUnavailable || isPending || input.findings.length >= 50
              }
              onClick={handleAddFinding}
              style={{
                padding: '3px 8px',
                fontSize: 11,
                fontWeight: 600,
                backgroundColor: 'var(--cth-paper-100, #ffffff)',
                border: BORDER,
                color: INK,
                cursor:
                  isHandleUnavailable || input.findings.length >= 50
                    ? 'not-allowed'
                    : 'pointer'
              }}
            >
              + Add Finding
            </button>
          </div>

          {input.findings.length === 0 ? (
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: BG_MUTED,
                fontSize: 11,
                color: 'var(--cth-ink-500, #64748b)',
                borderRadius: 2
              }}
            >
              No findings added.
            </div>
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              {input.findings.map((f: ReviewFindingInputDto, idx: number) => (
                <div
                  key={idx}
                  style={{
                    padding: 10,
                    backgroundColor: BG_MUTED,
                    border: BORDER,
                    borderRadius: 2
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 11 }}>
                      Finding #{idx + 1}
                    </span>
                    <button
                      type="button"
                      disabled={isHandleUnavailable || isPending}
                      onClick={() => handleRemoveFinding(idx)}
                      style={{
                        padding: '2px 6px',
                        fontSize: 10,
                        color: 'var(--cth-rose-dark, #e11d48)',
                        background: 'transparent',
                        border: '1px solid var(--cth-rose-dark, #e11d48)',
                        cursor: 'pointer'
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 120px',
                      gap: 8,
                      marginBottom: 8
                    }}
                  >
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: 10,
                          fontWeight: 600,
                          marginBottom: 2
                        }}
                      >
                        Code
                      </label>
                      <input
                        type="text"
                        value={f.code}
                        disabled={isHandleUnavailable || isPending}
                        placeholder="e.g. SEC-001"
                        onChange={(e) =>
                          handleUpdateFinding(idx, { code: e.target.value })
                        }
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '4px 6px',
                          fontSize: 11,
                          border: BORDER
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: 10,
                          fontWeight: 600,
                          marginBottom: 2
                        }}
                      >
                        Severity
                      </label>
                      <select
                        value={f.severity}
                        disabled={isHandleUnavailable || isPending}
                        onChange={(e) =>
                          handleUpdateFinding(idx, {
                            severity: e.target.value as ReviewFindingSeverityDto
                          })
                        }
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '4px 6px',
                          fontSize: 11,
                          border: BORDER,
                          backgroundColor: 'var(--cth-paper-100, #ffffff)'
                        }}
                      >
                        {REVIEW_FINDING_SEVERITIES.map((sev: ReviewFindingSeverityDto) => (
                          <option key={sev} value={sev}>
                            {sev}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 10,
                        fontWeight: 600,
                        marginBottom: 2
                      }}
                    >
                      Message
                    </label>
                    <input
                      type="text"
                      value={f.message}
                      disabled={isHandleUnavailable || isPending}
                      placeholder="Detailed finding message..."
                      onChange={(e) =>
                        handleUpdateFinding(idx, { message: e.target.value })
                      }
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '4px 6px',
                        fontSize: 11,
                        border: BORDER
                      }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 10,
                        fontWeight: 600,
                        marginBottom: 2
                      }}
                    >
                      Path (optional)
                    </label>
                    <input
                      type="text"
                      value={f.path ?? ''}
                      disabled={isHandleUnavailable || isPending}
                      placeholder="e.g. src/utils/format.ts"
                      onChange={(e) =>
                        handleUpdateFinding(idx, { path: e.target.value })
                      }
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '4px 6px',
                        fontSize: 11,
                        border: BORDER
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Validation Errors Box */}
        {validationError && (
          <div
            style={{
              padding: '8px 12px',
              marginBottom: 14,
              backgroundColor: 'var(--cth-rose-light, #ffe4e6)',
              border: '1px solid var(--cth-rose-dark, #e11d48)',
              color: 'var(--cth-rose-dark, #be123c)',
              fontSize: 11,
              borderRadius: 2
            }}
          >
            <strong>Validation Error:</strong> {validationError}
          </div>
        )}

        {/* Action Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => setShowConfirmModal(true)}
            style={{
              padding: '6px 18px',
              backgroundColor:
                !canSubmit
                  ? 'var(--cth-ink-300, #cbd5e1)'
                  : input.verdict === 'BLOCK'
                    ? 'var(--cth-rose-dark, #e11d48)'
                    : INK,
              color: '#ffffff',
              border: 'none',
              fontWeight: 600,
              fontSize: 12,
              cursor: !canSubmit ? 'not-allowed' : 'pointer'
            }}
          >
            {isPending ? 'Submitting...' : `Submit ${input.verdict}`}
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100
          }}
          onClick={() => setShowConfirmModal(false)}
        >
          <div
            style={{
              width: 480,
              backgroundColor: 'var(--cth-paper-100, #ffffff)',
              color: INK,
              border: `2px solid ${INK}`,
              boxShadow: `4px 4px 0 ${INK}`,
              padding: 20
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: '0 0 12px 0',
                fontSize: 15,
                fontWeight: 700,
                color:
                  input.verdict === 'BLOCK'
                    ? 'var(--cth-rose-dark, #e11d48)'
                    : INK
              }}
            >
              {confirmCopy.title}
            </h3>
            <p
              style={{
                margin: '0 0 20px 0',
                fontSize: 13,
                lineHeight: 1.5,
                color: 'var(--cth-ink-800, #1e293b)'
              }}
            >
              {confirmCopy.message}
            </p>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 12
              }}
            >
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                style={{
                  padding: '6px 14px',
                  backgroundColor: 'var(--cth-paper-100, #ffffff)',
                  border: BORDER,
                  color: INK,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteDecision}
                style={{
                  padding: '6px 16px',
                  backgroundColor:
                    input.verdict === 'BLOCK'
                      ? 'var(--cth-rose-dark, #e11d48)'
                      : INK,
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                {confirmCopy.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
