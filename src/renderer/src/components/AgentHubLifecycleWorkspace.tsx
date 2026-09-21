import React, { useEffect, useMemo, useState } from 'react';
import { useAgentHubStore } from '../stores/agentHubStore';
import { useAgentHubReviewSessionStore } from '../stores/agentHubReviewSessionStore';
import {
  HUMAN_BOSS_ACTOR_ID,
  TASK_COMPLEXITIES,
  TASK_RISKS,
  isLifecycleCompatibleBackendVersion,
  isPlanReviewReconciliationError,
  lifecycleReviewEntryForTask,
  shortenProposalHash,
  type CreatePlanDependencyInputDto,
  type CreatePlanTaskInputDto,
  type LifecycleMutationResult,
  type PlanDto,
  type TaskComplexity,
  type TaskRisk
} from '@shared/agenthubTypes';
import { TaskSubmissionIdLifecycle, InvalidSubmissionTransitionError } from '@shared/agenthubSubmissionLifecycle';

interface AgentHubLifecycleWorkspaceProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DraftTask {
  clientId: string;
  parentClientId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  requiredCapabilities: string;
  requiredSpecialties: string;
  complexity: TaskComplexity;
  risk: TaskRisk;
}

interface DraftEdge {
  prerequisiteClientId: string;
  dependentClientId: string;
}

function parseList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function emptyDraftTask(index: number): DraftTask {
  return {
    clientId: `t${index}`,
    parentClientId: '',
    title: '',
    description: '',
    acceptanceCriteria: '',
    requiredCapabilities: '',
    requiredSpecialties: '',
    complexity: 'MEDIUM',
    risk: 'LOW'
  };
}

function toCreateTasks(drafts: readonly DraftTask[]): CreatePlanTaskInputDto[] {
  return drafts.map((draft) => ({
    clientId: draft.clientId.trim(),
    parentClientId: draft.parentClientId.trim() ? draft.parentClientId.trim() : null,
    title: draft.title,
    description: draft.description.trim() ? draft.description : null,
    acceptanceCriteria: parseList(draft.acceptanceCriteria),
    requiredCapabilities: parseList(draft.requiredCapabilities),
    requiredSpecialties: parseList(draft.requiredSpecialties),
    complexity: draft.complexity,
    risk: draft.risk
  }));
}

function toCreateDeps(edges: readonly DraftEdge[]): CreatePlanDependencyInputDto[] {
  return edges
    .filter((edge) => edge.prerequisiteClientId.trim() && edge.dependentClientId.trim())
    .map((edge) => ({
      prerequisiteClientId: edge.prerequisiteClientId.trim(),
      dependentClientId: edge.dependentClientId.trim()
    }));
}

export function AgentHubLifecycleWorkspace({
  isOpen,
  onClose
}: AgentHubLifecycleWorkspaceProps): React.ReactElement | null {
  const {
    connection,
    health,
    snapshot,
    lifecycleReviews,
    lastError,
    isRefreshing,
    refresh,
    createIntake,
    createPlan,
    createPlanRevision,
    approvePlan,
    requestPlanChanges,
    rejectPlan,
    startPlan
  } = useAgentHubStore();
  const openReviewModal = useAgentHubReviewSessionStore((s) => s.openModal);

  const projects = snapshot?.projects ?? [];
  const agents = snapshot?.agents ?? [];
  const intakes = snapshot?.intakes ?? [];
  const plans = snapshot?.plans ?? [];
  const lifecycleCompatible = health !== null && isLifecycleCompatibleBackendVersion(health.version);
  const reviewReconciliationRequired = isPlanReviewReconciliationError(lastError?.code);
  const mutationsUsable = lifecycleCompatible && !reviewReconciliationRequired
    && (connection === 'connected' || connection === 'degraded');

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  const [leadAgentId, setLeadAgentId] = useState('');
  const [intakeId, setIntakeId] = useState('');
  const [goal, setGoal] = useState('');
  const [summary, setSummary] = useState('');
  const [decisionSummary, setDecisionSummary] = useState('');
  const [tasks, setTasks] = useState<DraftTask[]>([emptyDraftTask(1)]);
  const [edges, setEdges] = useState<DraftEdge[]>([]);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'applied' | 'ambiguous' | 'failed'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const lifecycleRef = React.useRef(new TaskSubmissionIdLifecycle());
  const lastMutationRef = React.useRef<((id: string) => Promise<LifecycleMutationResult>) | null>(null);
  const [mutationId, setMutationId] = useState(lifecycleRef.current.id);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.planId === selectedPlanId) ?? null,
    [plans, selectedPlanId]
  );

  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0].projectId);
    }
  }, [projectId, projects]);

  useEffect(() => {
    if (!leadAgentId && agents.length > 0) {
      setLeadAgentId(agents[0].agentId);
    }
  }, [agents, leadAgentId]);

  useEffect(() => {
    if (!intakeId && intakes.length > 0) {
      setIntakeId(intakes[0].intakeId);
    }
  }, [intakeId, intakes]);

  useEffect(() => {
    if (selectedPlanId && !plans.some((plan) => plan.planId === selectedPlanId)) {
      setSelectedPlanId(null);
    }
  }, [plans, selectedPlanId]);

  if (!isOpen) return null;

  const rotateAfterEdit = (): void => {
    if (status === 'ambiguous' || status === 'failed' || status === 'applied') {
      lifecycleRef.current.onEdit();
      setMutationId(lifecycleRef.current.id);
      setStatus('idle');
      setErrorMessage(null);
      setWarningMessage(null);
    }
  };

  const applyResult = (result: LifecycleMutationResult): void => {
    if (result.status === 'applied') {
      lifecycleRef.current.onResult('applied');
      setMutationId(lifecycleRef.current.id);
      setStatus('applied');
      setErrorMessage(null);
      setWarningMessage(result.stateSynchronized ? null : result.warning.message);
      return;
    }
    if (result.status === 'failed') {
      lifecycleRef.current.onResult('failed');
      setMutationId(lifecycleRef.current.id);
      setStatus('failed');
      setErrorMessage(`${result.error.code}: ${result.error.message}`);
      return;
    }
    lifecycleRef.current.onResult('ambiguous');
    setMutationId(lifecycleRef.current.id);
    setStatus('ambiguous');
    setErrorMessage(`${result.error.code}: ${result.error.message}`);
  };

  const runMutation = async (fn: (id: string) => Promise<LifecycleMutationResult>, retry = false): Promise<void> => {
    if (!mutationsUsable || status === 'submitting') return;
    let id: string;
    try {
      id = retry ? lifecycleRef.current.beginRetry() : lifecycleRef.current.beginSubmit();
    } catch (err) {
      if (err instanceof InvalidSubmissionTransitionError) {
        setStatus('failed');
        setErrorMessage(err.message);
        return;
      }
      throw err;
    }
    setMutationId(id);
    setStatus('submitting');
    setErrorMessage(null);
    setWarningMessage(null);
    lastMutationRef.current = fn;

    let result: LifecycleMutationResult;
    try {
      result = await fn(id);
    } catch (err: any) {
      lifecycleRef.current.onResult('ambiguous');
      setMutationId(lifecycleRef.current.id);
      setStatus('ambiguous');
      setErrorMessage(err?.message || 'Lifecycle mutation outcome is unknown');
      return;
    }

    applyResult(result);
  };

  const boundDecision = (plan: PlanDto) => ({
    planVersion: plan.current.version,
    proposalHash: plan.current.proposalHash,
    actorId: HUMAN_BOSS_ACTOR_ID,
    summary: decisionSummary
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: 'rgba(15,23,42,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        className="cth-titlebar-nodrag"
        style={{
          width: 980,
          maxWidth: '96vw',
          maxHeight: '92vh',
          overflow: 'auto',
          background: '#fff',
          color: '#0f172a',
          border: '2px solid #0f172a',
          boxShadow: '6px 6px 0 #0f172a',
          padding: 16
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Backend Lifecycle Workspace</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              Human Boss decides. Backend Lead Agent owns the Plan. Specialists execute Backend-created Tasks.
            </div>
          </div>
          <div>
            <button type="button" onClick={() => { void refresh(); }} disabled={isRefreshing}>
              Refresh
            </button>
            <button type="button" onClick={onClose} style={{ marginLeft: 8 }}>
              Close
            </button>
          </div>
        </div>

        {!lifecycleCompatible && (
          <div style={{ marginTop: 12, padding: 10, background: '#fef3c7', border: '1px solid #ca8a04' }}>
            Lifecycle unavailable. Backend upgrade required.
            {health ? ` Current version: ${health.version}. Supported: 0.7.3K.` : ' Health is unknown.'}
            This is not an empty plan list.
          </div>
        )}

        {lifecycleCompatible && connection === 'disconnected' && (
          <div style={{ marginTop: 12, padding: 10, background: '#fee2e2' }}>
            Backend disconnected. Last snapshot is stale presentation only. Lifecycle mutations are disabled.
          </div>
        )}

        {lifecycleCompatible && lastError && (snapshot === null || reviewReconciliationRequired) && (
          <div style={{ marginTop: 12, padding: 10, background: '#fee2e2' }}>
            {reviewReconciliationRequired
              ? `Backend review reconciliation required [${lastError.code}]: ${lastError.message}`
              : `Contract/state failure [${lastError.code}]: ${lastError.message}`}
          </div>
        )}

        {status === 'ambiguous' && (
          <div style={{ marginTop: 12, padding: 10, background: '#fef9c3' }}>
            正在确认后端状态… {errorMessage}
            <div>
              <button
                type="button"
                onClick={() => {
                  const last = lastMutationRef.current;
                  if (!last) {
                    void refresh();
                    return;
                  }
                  void runMutation(last, true);
                }}
                disabled={!mutationsUsable}
              >
                Retry same mutation
              </button>
            </div>
          </div>
        )}

        {status === 'failed' && <div style={{ marginTop: 12, color: '#e11d48' }}>{errorMessage}</div>}
        {warningMessage && <div style={{ marginTop: 12, color: '#ca8a04' }}>{warningMessage}</div>}

        {lifecycleCompatible && snapshot && !reviewReconciliationRequired && (
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, marginTop: 16 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Intakes</div>
              {intakes.length === 0 && <div style={{ fontSize: 12, color: '#64748b' }}>No intakes on this compatible Backend.</div>}
              {intakes.map((intake) => (
                <button
                  key={intake.intakeId}
                  type="button"
                  onClick={() => setIntakeId(intake.intakeId)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    marginBottom: 6,
                    background: intakeId === intake.intakeId ? '#d0f0e0' : '#fff'
                  }}
                >
                  {intake.goal.slice(0, 72)}
                  <div style={{ fontSize: 11, color: '#64748b' }}>Lead {intake.leadAgentId}</div>
                </button>
              ))}
              <div style={{ fontWeight: 700, margin: '16px 0 8px' }}>Plans</div>
              {plans.length === 0 && <div style={{ fontSize: 12, color: '#64748b' }}>No plans on this compatible Backend.</div>}
              {plans.map((plan) => (
                <button
                  key={plan.planId}
                  type="button"
                  onClick={() => setSelectedPlanId(plan.planId)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    marginBottom: 6,
                    background: selectedPlanId === plan.planId ? '#d0f0e0' : '#fff'
                  }}
                >
                  {plan.current.summary.slice(0, 72)}
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {plan.state} · v{plan.currentVersion} · {shortenProposalHash(plan.current.proposalHash)}
                  </div>
                </button>
              ))}
            </div>

            <div>
              <div style={{ fontWeight: 700 }}>Compose Intake / Plan</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <label>
                  Project
                  <select value={projectId} onChange={(e) => { rotateAfterEdit(); setProjectId(e.target.value); }}>
                    {projects.map((project) => (
                      <option key={project.projectId} value={project.projectId}>{project.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Lead Agent
                  <select value={leadAgentId} onChange={(e) => { rotateAfterEdit(); setLeadAgentId(e.target.value); }}>
                    {agents.map((agent) => (
                      <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label style={{ display: 'block', marginTop: 8 }}>
                Intake goal
                <textarea value={goal} onChange={(e) => { rotateAfterEdit(); setGoal(e.target.value); }} rows={3} style={{ width: '100%' }} />
              </label>
              <button
                type="button"
                disabled={!mutationsUsable || status === 'submitting'}
                onClick={() => {
                  void runMutation((id) => createIntake({
                    mutationId: id,
                    input: { projectId, createdBy: HUMAN_BOSS_ACTOR_ID, goal, leadAgentId }
                  }));
                }}
              >
                Create Intake
              </button>

              <label style={{ display: 'block', marginTop: 12 }}>
                Plan summary
                <textarea value={summary} onChange={(e) => { rotateAfterEdit(); setSummary(e.target.value); }} rows={2} style={{ width: '100%' }} />
              </label>
              {tasks.map((task, index) => (
                <div key={task.clientId + String(index)} style={{ border: '1px solid #cbd5e1', padding: 8, marginTop: 8 }}>
                  <input value={task.clientId} onChange={(e) => {
                    rotateAfterEdit();
                    setTasks(tasks.map((item, i) => i === index ? { ...item, clientId: e.target.value } : item));
                  }} placeholder="clientId" />
                  <input value={task.title} onChange={(e) => {
                    rotateAfterEdit();
                    setTasks(tasks.map((item, i) => i === index ? { ...item, title: e.target.value } : item));
                  }} placeholder="title" style={{ marginLeft: 6 }} />
                  <select value={task.complexity} onChange={(e) => {
                    rotateAfterEdit();
                    setTasks(tasks.map((item, i) => i === index ? { ...item, complexity: e.target.value as TaskComplexity } : item));
                  }}>
                    {TASK_COMPLEXITIES.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                  <select value={task.risk} onChange={(e) => {
                    rotateAfterEdit();
                    setTasks(tasks.map((item, i) => i === index ? { ...item, risk: e.target.value as TaskRisk } : item));
                  }}>
                    {TASK_RISKS.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
              ))}
              <button type="button" onClick={() => { rotateAfterEdit(); setTasks([...tasks, emptyDraftTask(tasks.length + 1)]); }}>
                Add task row
              </button>
              {edges.map((edge, index) => (
                <div key={String(index)} style={{ marginTop: 6 }}>
                  <input value={edge.prerequisiteClientId} onChange={(e) => {
                    rotateAfterEdit();
                    setEdges(edges.map((item, i) => i === index ? { ...item, prerequisiteClientId: e.target.value } : item));
                  }} placeholder="prerequisiteClientId" />
                  <span> → </span>
                  <input value={edge.dependentClientId} onChange={(e) => {
                    rotateAfterEdit();
                    setEdges(edges.map((item, i) => i === index ? { ...item, dependentClientId: e.target.value } : item));
                  }} placeholder="dependentClientId" />
                </div>
              ))}
              <button type="button" onClick={() => { rotateAfterEdit(); setEdges([...edges, { prerequisiteClientId: '', dependentClientId: '' }]); }}>
                Add dependency
              </button>
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  disabled={!mutationsUsable || status === 'submitting'}
                  onClick={() => {
                    void runMutation((id) => createPlan({
                      mutationId: id,
                      input: {
                        intakeId,
                        leadAgentId,
                        summary,
                        tasks: toCreateTasks(tasks),
                        dependencies: toCreateDeps(edges)
                      }
                    }));
                  }}
                >
                  Create Plan
                </button>
              </div>

              {selectedPlan && (
                <div style={{ marginTop: 16, borderTop: '1px solid #cbd5e1', paddingTop: 12 }}>
                  <div style={{ fontWeight: 700 }}>Selected Plan</div>
                  <div>State: {selectedPlan.state}</div>
                  <div>Version {selectedPlan.currentVersion} · Proposal {shortenProposalHash(selectedPlan.current.proposalHash)}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11 }}>{selectedPlan.current.proposalHash}</div>
                  <div>
                    Aggregate: {selectedPlan.aggregate.completed}/{selectedPlan.aggregate.total} completed · {selectedPlan.aggregate.blocked} blocked · {selectedPlan.aggregate.eligible} eligible · {selectedPlan.aggregate.reviewing} reviewing
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {selectedPlan.tasks.map((task) => {
                      const entry = lifecycleReviewEntryForTask(
                        task,
                        lifecycleReviews ?? [],
                        selectedPlan.planId
                      );
                      return (
                        <div key={task.planTaskId} style={{ fontSize: 12, marginBottom: 8 }}>
                          <div>
                            {task.title} · eligibility {task.dependencyState} · runtime {task.runtimeState}
                          </div>
                          {entry.kind === 'review' && (
                            <button
                              type="button"
                              onClick={() => openReviewModal(entry.runtimeTaskId)}
                            >
                              Review {entry.title}
                            </button>
                          )}
                          {entry.kind === 'syncing' && (
                            <div style={{ color: '#64748b' }}>Review evidence syncing / unavailable</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <label style={{ display: 'block', marginTop: 8 }}>
                    Decision summary
                    <input value={decisionSummary} onChange={(e) => { rotateAfterEdit(); setDecisionSummary(e.target.value); }} style={{ width: '100%' }} />
                  </label>
                  {selectedPlan.state === 'WAITING_APPROVAL' && (
                    <>
                      <button type="button" disabled={!mutationsUsable || status === 'submitting'} onClick={() => {
                        void runMutation((id) => approvePlan({ mutationId: id, planId: selectedPlan.planId, input: boundDecision(selectedPlan) }));
                      }}>Approve</button>
                      <button type="button" disabled={!mutationsUsable || status === 'submitting'} onClick={() => {
                        void runMutation((id) => requestPlanChanges({ mutationId: id, planId: selectedPlan.planId, input: boundDecision(selectedPlan) }));
                      }}>Request Changes</button>
                      <button type="button" disabled={!mutationsUsable || status === 'submitting'} onClick={() => {
                        void runMutation((id) => rejectPlan({ mutationId: id, planId: selectedPlan.planId, input: boundDecision(selectedPlan) }));
                      }}>Reject</button>
                    </>
                  )}
                  {selectedPlan.state === 'CHANGES_REQUESTED' && (
                    <button type="button" disabled={!mutationsUsable || status === 'submitting'} onClick={() => {
                      void runMutation((id) => createPlanRevision({
                        mutationId: id,
                        planId: selectedPlan.planId,
                        input: {
                          basedOnVersion: selectedPlan.currentVersion,
                          leadAgentId: selectedPlan.leadAgentId,
                          summary,
                          tasks: toCreateTasks(tasks),
                          dependencies: toCreateDeps(edges)
                        }
                      }));
                    }}>Create Revision</button>
                  )}
                  {selectedPlan.state === 'APPROVED' && (
                    <button type="button" disabled={!mutationsUsable || status === 'submitting'} onClick={() => {
                      void runMutation((id) => startPlan({
                        mutationId: id,
                        planId: selectedPlan.planId,
                        input: {
                          planVersion: selectedPlan.current.version,
                          proposalHash: selectedPlan.current.proposalHash
                        }
                      }));
                    }}>Start</button>
                  )}
                  {(selectedPlan.state === 'COMPLETED' || selectedPlan.state === 'FAILED' || selectedPlan.state === 'REJECTED') && (
                    <div style={{ fontSize: 12, color: '#64748b' }}>No illegal Plan mutations in {selectedPlan.state}.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}