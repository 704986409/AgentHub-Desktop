import React, { useMemo, useState } from 'react';
import { useAgentHubReviewSessionStore } from '../stores/agentHubReviewSessionStore';
import { useAgentHubStore } from '../stores/agentHubStore';
import {
  formatCommittedPatch,
  formatDisplayPreview,
  formatExitCode
} from './agentHubReviewPresentation';
import { AgentHubReviewDecisionSection } from './AgentHubReviewDecisionSection';

interface AgentHubReviewEvidenceModalProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const INK = 'var(--cth-ink-900, #0f172a)';
const BORDER = `1px solid var(--cth-ink-300, #cbd5e1)`;
const BG_MUTED = 'var(--cth-paper-200, #f8fafc)';

export function AgentHubReviewEvidenceModal({
  isOpen: propIsOpen,
  onClose: propOnClose
}: AgentHubReviewEvidenceModalProps) {
  const storeIsOpen = useAgentHubReviewSessionStore((s) => s.isModalOpen);
  const closeModal = useAgentHubReviewSessionStore((s) => s.closeModal);
  const reviewReadyByTaskId = useAgentHubReviewSessionStore(
    (s) => s.reviewReadyByTaskId
  );
  const selectedReviewTaskId = useAgentHubReviewSessionStore(
    (s) => s.selectedReviewTaskId
  );
  const selectReviewTask = useAgentHubReviewSessionStore(
    (s) => s.selectReviewTask
  );

  const tasks = useAgentHubStore((s) => s.snapshot?.tasks ?? []);

  const isOpen = propIsOpen !== undefined ? propIsOpen : storeIsOpen;
  const handleClose = propOnClose ?? closeModal;

  const [showAllPaths, setShowAllPaths] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const taskIds = useMemo(
    () => Object.keys(reviewReadyByTaskId),
    [reviewReadyByTaskId]
  );

  const activeTaskId =
    selectedReviewTaskId && reviewReadyByTaskId[selectedReviewTaskId]
      ? selectedReviewTaskId
      : taskIds.length > 0
        ? taskIds[0]
        : null;

  const activeRecord = activeTaskId ? reviewReadyByTaskId[activeTaskId] : null;

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Ignore clipboard write failures
    }
  };

  if (!isOpen) return null;

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
      onClick={handleClose}
    >
      <div
        style={{
          width: 740,
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
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 16
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                AgentHub — Review Evidence
              </h2>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  padding: '2px 6px',
                  backgroundColor: 'var(--cth-ink-200, #e2e8f0)',
                  color: 'var(--cth-ink-700, #334155)',
                  borderRadius: 2
                }}
              >
                SESSION CAPTURE · READ ONLY
              </span>
            </div>
            <p
              style={{
                margin: '4px 0 0 0',
                fontSize: 12,
                color: 'var(--cth-ink-500, #64748b)'
              }}
            >
              Inspecting public execute evidence confirmed in this Desktop session.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
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

        {/* Empty State */}
        {!activeRecord ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              backgroundColor: BG_MUTED,
              border: BORDER,
              borderRadius: 2,
              margin: '16px 0'
            }}
          >
            <div
              style={{
                fontWeight: 600,
                fontSize: 14,
                marginBottom: 6,
                color: INK
              }}
            >
              No review evidence captured in this Desktop session.
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--cth-ink-500, #64748b)',
                lineHeight: 1.5
              }}
            >
              Evidence appears here after a task execution returns a confirmed review-ready result.
            </div>
            <button
              type="button"
              onClick={handleClose}
              style={{
                marginTop: 16,
                padding: '6px 14px',
                backgroundColor: 'var(--cth-paper-100, #ffffff)',
                border: `1px solid ${INK}`,
                color: INK,
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        ) : (
          <div>
            {/* Task Selector if multiple tasks captured */}
            {taskIds.length > 1 && (
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: 'block',
                    fontWeight: 600,
                    fontSize: 12,
                    marginBottom: 4
                  }}
                >
                  Captured Tasks ({taskIds.length})
                </label>
                <select
                  value={activeTaskId ?? ''}
                  onChange={(e) => selectReviewTask(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: `1px solid ${INK}`,
                    backgroundColor: 'var(--cth-paper-100, #ffffff)',
                    fontFamily: 'inherit',
                    fontSize: 12
                  }}
                >
                  {taskIds.map((id) => {
                    const taskInSnapshot = tasks.find((t) => t.taskId === id);
                    const label = taskInSnapshot
                      ? `${taskInSnapshot.title} (${id})`
                      : id;
                    return (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {/* State Synchronized Warning */}
            {!activeRecord.stateSynchronized && activeRecord.warning && (
              <div
                style={{
                  padding: '8px 12px',
                  marginBottom: 16,
                  backgroundColor: 'var(--cth-amber-light, #fef3c7)',
                  border: '1px solid var(--cth-amber-dark, #ca8a04)',
                  color: 'var(--cth-amber-dark, #ca8a04)',
                  fontSize: 12,
                  borderRadius: 2
                }}
              >
                <strong>Warning [{activeRecord.warning.code}]:</strong>{' '}
                {activeRecord.warning.message}
              </div>
            )}

            {/* Section: Overview & Identity */}
            <div
              style={{
                border: BORDER,
                borderRadius: 2,
                padding: 12,
                marginBottom: 12,
                backgroundColor: BG_MUTED
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  marginBottom: 8,
                  borderBottom: BORDER,
                  paddingBottom: 4
                }}
              >
                Execution & Review Identity
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  gap: '6px 12px',
                  fontSize: 12
                }}
              >
                <div>Task ID:</div>
                <div style={{ fontFamily: 'monospace' }}>
                  {activeRecord.review.taskId}
                </div>

                <div>Assignment ID:</div>
                <div style={{ fontFamily: 'monospace' }}>
                  {activeRecord.review.assignmentId}
                </div>

                <div>Agent ID:</div>
                <div style={{ fontFamily: 'monospace' }}>
                  {activeRecord.review.agentId}
                </div>

                <div>Provider ID:</div>
                <div>{activeRecord.review.providerId}</div>

                <div>Review Handle:</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                    {activeRecord.review.reviewHandle}
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(activeRecord.review.reviewHandle, 'handle')
                    }
                    style={{
                      fontSize: 10,
                      padding: '1px 4px',
                      cursor: 'pointer'
                    }}
                  >
                    {copiedKey === 'handle' ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <div>Review Bundle SHA-256:</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                    {activeRecord.review.reviewBundleSha256}
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(
                        activeRecord.review.reviewBundleSha256,
                        'bundleSha'
                      )
                    }
                    style={{
                      fontSize: 10,
                      padding: '1px 4px',
                      cursor: 'pointer'
                    }}
                  >
                    {copiedKey === 'bundleSha' ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <div>Evidence SHA-256:</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                    {activeRecord.review.evidenceSha256}
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(
                        activeRecord.review.evidenceSha256,
                        'evidenceSha'
                      )
                    }
                    style={{
                      fontSize: 10,
                      padding: '1px 4px',
                      cursor: 'pointer'
                    }}
                  >
                    {copiedKey === 'evidenceSha' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            {/* Section: Worker Result */}
            <div
              style={{
                border: BORDER,
                borderRadius: 2,
                padding: 12,
                marginBottom: 12,
                backgroundColor: 'var(--cth-paper-100, #ffffff)'
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  marginBottom: 8,
                  borderBottom: BORDER,
                  paddingBottom: 4
                }}
              >
                Worker Result
              </div>
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                <strong>Summary:</strong>
                <div
                  style={{
                    marginTop: 4,
                    padding: 8,
                    backgroundColor: BG_MUTED,
                    border: BORDER,
                    borderRadius: 2,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {activeRecord.review.workerResult.summary}
                </div>
              </div>

              {/* Lists */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                  fontSize: 12
                }}
              >
                <div>
                  <strong>
                    Blockers ({activeRecord.review.workerResult.blockers.length})
                  </strong>
                  {activeRecord.review.workerResult.blockers.length > 0 ? (
                    <ul style={{ margin: '4px 0 0 0', paddingLeft: 16 }}>
                      {activeRecord.review.workerResult.blockers.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ color: 'var(--cth-ink-400, #94a3b8)' }}>None</div>
                  )}
                </div>

                <div>
                  <strong>
                    Questions ({activeRecord.review.workerResult.questions.length})
                  </strong>
                  {activeRecord.review.workerResult.questions.length > 0 ? (
                    <ul style={{ margin: '4px 0 0 0', paddingLeft: 16 }}>
                      {activeRecord.review.workerResult.questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ color: 'var(--cth-ink-400, #94a3b8)' }}>None</div>
                  )}
                </div>

                <div>
                  <strong>
                    Risks ({activeRecord.review.workerResult.risks.length})
                  </strong>
                  {activeRecord.review.workerResult.risks.length > 0 ? (
                    <ul style={{ margin: '4px 0 0 0', paddingLeft: 16 }}>
                      {activeRecord.review.workerResult.risks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ color: 'var(--cth-ink-400, #94a3b8)' }}>None</div>
                  )}
                </div>

                <div>
                  <strong>
                    Notes ({activeRecord.review.workerResult.notes.length})
                  </strong>
                  {activeRecord.review.workerResult.notes.length > 0 ? (
                    <ul style={{ margin: '4px 0 0 0', paddingLeft: 16 }}>
                      {activeRecord.review.workerResult.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ color: 'var(--cth-ink-400, #94a3b8)' }}>None</div>
                  )}
                </div>
              </div>
            </div>

            {/* Section: Source */}
            <div
              style={{
                border: BORDER,
                borderRadius: 2,
                padding: 12,
                marginBottom: 12,
                backgroundColor: BG_MUTED
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  marginBottom: 8,
                  borderBottom: BORDER,
                  paddingBottom: 4
                }}
              >
                Source & Changes
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  gap: '6px 12px',
                  fontSize: 12,
                  marginBottom: 10
                }}
              >
                <div>Branch:</div>
                <div style={{ fontFamily: 'monospace' }}>
                  {activeRecord.review.source.branchName}
                </div>

                <div>Base Commit:</div>
                <div style={{ fontFamily: 'monospace' }}>
                  {activeRecord.review.source.baseCommit}
                </div>

                <div>Head Commit:</div>
                <div style={{ fontFamily: 'monospace' }}>
                  {activeRecord.review.source.headCommit}
                </div>

                <div>Change Set SHA-256:</div>
                <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {activeRecord.review.source.changeSetSha256}
                </div>
              </div>

              {/* Changed Paths */}
              <div style={{ marginBottom: 10, fontSize: 12 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 4
                  }}
                >
                  <strong>
                    Changed Paths ({activeRecord.review.source.changedPaths.length})
                  </strong>
                  {activeRecord.review.source.changedPaths.length > 50 && (
                    <span style={{ fontSize: 11, color: 'var(--cth-ink-500, #64748b)' }}>
                      {showAllPaths
                        ? `Showing all ${activeRecord.review.source.changedPaths.length}`
                        : `Showing 50 of ${activeRecord.review.source.changedPaths.length} changed paths`}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    maxHeight: 160,
                    overflowY: 'auto',
                    backgroundColor: 'var(--cth-paper-100, #ffffff)',
                    border: BORDER,
                    padding: '6px 8px',
                    fontFamily: 'monospace',
                    fontSize: 11
                  }}
                >
                  {(showAllPaths
                    ? activeRecord.review.source.changedPaths
                    : activeRecord.review.source.changedPaths.slice(0, 50)
                  ).map((pathStr, i) => (
                    <div key={i}>{pathStr}</div>
                  ))}
                  {!showAllPaths &&
                    activeRecord.review.source.changedPaths.length > 50 && (
                      <div
                        style={{
                          color: 'var(--cth-ink-400, #94a3b8)',
                          marginTop: 4
                        }}
                      >
                        ... and{' '}
                        {activeRecord.review.source.changedPaths.length - 50}{' '}
                        more paths
                      </div>
                    )}
                </div>
                {activeRecord.review.source.changedPaths.length > 50 && (
                  <button
                    type="button"
                    onClick={() => setShowAllPaths(!showAllPaths)}
                    style={{
                      marginTop: 4,
                      fontSize: 11,
                      padding: '2px 8px',
                      cursor: 'pointer'
                    }}
                  >
                    {showAllPaths ? 'Show first 50' : 'Show all paths'}
                  </button>
                )}
              </div>

              {/* Committed Patch */}
              <div style={{ fontSize: 12 }}>
                <strong>Committed Patch:</strong>
                <pre
                  style={{
                    margin: '4px 0 0 0',
                    maxHeight: 160,
                    overflowY: 'auto',
                    backgroundColor: 'var(--cth-paper-100, #ffffff)',
                    border: BORDER,
                    padding: '6px 8px',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {formatCommittedPatch(
                    activeRecord.review.source.committedPatch
                  )}
                </pre>
              </div>
            </div>

            {/* Section: Build / Test Summary */}
            <div
              style={{
                border: BORDER,
                borderRadius: 2,
                padding: 12,
                marginBottom: 12,
                backgroundColor: 'var(--cth-paper-100, #ffffff)'
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  marginBottom: 8,
                  borderBottom: BORDER,
                  paddingBottom: 4
                }}
              >
                Build & Test Summary
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8,
                  fontSize: 12
                }}
              >
                <div>
                  <strong>Build:</strong>{' '}
                  <span
                    style={{
                      color:
                        activeRecord.review.buildTest.build === 'passed'
                          ? 'var(--cth-mint-dark, #16a34a)'
                          : 'var(--cth-rose-dark, #e11d48)'
                    }}
                  >
                    {activeRecord.review.buildTest.build}
                  </span>
                </div>
                <div>
                  <strong>Test:</strong>{' '}
                  <span
                    style={{
                      color:
                        activeRecord.review.buildTest.test === 'passed'
                          ? 'var(--cth-mint-dark, #16a34a)'
                          : 'var(--cth-rose-dark, #e11d48)'
                    }}
                  >
                    {activeRecord.review.buildTest.test}
                  </span>
                </div>
                <div>
                  <strong>Evidence Outcome:</strong>{' '}
                  <span>{activeRecord.review.buildTest.outcome}</span>
                </div>
              </div>
            </div>

            {/* Section: Commands */}
            <div
              style={{
                border: BORDER,
                borderRadius: 2,
                padding: 12,
                marginBottom: 16,
                backgroundColor: BG_MUTED
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  marginBottom: 8,
                  borderBottom: BORDER,
                  paddingBottom: 4
                }}
              >
                Build & Test Commands ({activeRecord.review.buildTest.commands.length})
              </div>
              {activeRecord.review.buildTest.commands.length === 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--cth-ink-500, #64748b)'
                  }}
                >
                  No command evidence reported.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {activeRecord.review.buildTest.commands.map((cmd) => (
                    <div
                      key={cmd.id}
                      style={{
                        backgroundColor: 'var(--cth-paper-100, #ffffff)',
                        border: BORDER,
                        borderRadius: 2,
                        padding: 8,
                        fontSize: 12
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: 4,
                          fontWeight: 600
                        }}
                      >
                        <div>
                          [{cmd.phase.toUpperCase()}] Command ID: {cmd.id}
                        </div>
                        <div>
                          Outcome: {cmd.outcome} (Exit Code:{' '}
                          {formatExitCode(cmd.exitCode)})
                        </div>
                      </div>
                      {cmd.stdoutPreview && (
                        <div style={{ marginTop: 4 }}>
                          <div
                            style={{
                              fontSize: 10,
                              color: 'var(--cth-ink-500, #64748b)'
                            }}
                          >
                            stdout preview:
                          </div>
                          <pre
                            style={{
                              margin: 0,
                              maxHeight: 100,
                              overflowY: 'auto',
                              backgroundColor: BG_MUTED,
                              padding: 4,
                              fontFamily: 'monospace',
                              fontSize: 11,
                              whiteSpace: 'pre-wrap'
                            }}
                          >
                            {formatDisplayPreview(cmd.stdoutPreview)}
                          </pre>
                        </div>
                      )}
                      {cmd.stderrPreview && (
                        <div style={{ marginTop: 4 }}>
                          <div
                            style={{
                              fontSize: 10,
                              color: 'var(--cth-rose-dark, #e11d48)'
                            }}
                          >
                            stderr preview:
                          </div>
                          <pre
                            style={{
                              margin: 0,
                              maxHeight: 100,
                              overflowY: 'auto',
                              backgroundColor: 'var(--cth-rose-light, #ffe4e6)',
                              padding: 4,
                              fontFamily: 'monospace',
                              fontSize: 11,
                              whiteSpace: 'pre-wrap'
                            }}
                          >
                            {formatDisplayPreview(cmd.stderrPreview)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Human Review Decision Section */}
            {activeTaskId && activeRecord.review.reviewHandle && (
              <AgentHubReviewDecisionSection
                taskId={activeTaskId}
                reviewHandle={activeRecord.review.reviewHandle}
                stateSynchronized={activeRecord.stateSynchronized}
              />
            )}

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: 16
              }}
            >
              <button
                type="button"
                onClick={handleClose}
                style={{
                  padding: '6px 16px',
                  backgroundColor: 'var(--cth-paper-100, #ffffff)',
                  border: `1px solid ${INK}`,
                  color: INK,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
