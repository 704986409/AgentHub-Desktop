import { create } from 'zustand';
import type {
  AgentActionRequestDto,
  CreateAgentInputDto,
  CreateAgentRequestDto,
  UpdateAgentInputDto,
  UpdateAgentRequestDto
} from '@shared/agenthubTypes';

export type AgentMutationOperation = 'create' | 'update' | 'enable' | 'disable' | 'delete';

export interface AgentMutationSession {
  mutationId: string;
  operation: AgentMutationOperation;
  agentId?: string;
  createInput?: CreateAgentInputDto;
  updateInput?: UpdateAgentInputDto;
  status: 'idle' | 'submitting' | 'ambiguous' | 'applied' | 'failed';
  error?: {
    code: string;
    message: string;
  };
}

interface AgentHubAgentMutationStore {
  session: AgentMutationSession | null;
  beginCreate: () => string;
  beginUpdate: (agentId: string, input: UpdateAgentInputDto) => string;
  beginAction: (operation: 'enable' | 'disable' | 'delete', agentId: string) => string;
  startFreshCreate: () => string;
  startFreshUpdate: (agentId: string, input: UpdateAgentInputDto) => string;
  startFreshAction: (operation: 'enable' | 'disable' | 'delete', agentId: string) => string;
  abandonAmbiguous: () => void;
  markSubmitting: (mutationId: string) => void;
  markAmbiguous: (mutationId: string, error: { code: string; message: string }) => void;
  markApplied: (mutationId: string) => void;
  markFailed: (mutationId: string, error: { code: string; message: string }) => void;
  rotateAfterEdit: (mutationId: string, input: CreateAgentInputDto | UpdateAgentInputDto) => string;
  clearSession: () => void;
  createRequest: (mutationId: string, input: CreateAgentInputDto) => CreateAgentRequestDto | null;
  updateRequest: (mutationId: string, agentId: string, input: UpdateAgentInputDto) => UpdateAgentRequestDto | null;
  actionRequest: (mutationId: string, agentId: string) => AgentActionRequestDto | null;
}

function newMutationId(): string {
  return crypto.randomUUID();
}

export const useAgentHubAgentMutationStore = create<AgentHubAgentMutationStore>((set, get) => ({
  session: null,

  beginCreate: () => {
    return get().startFreshCreate();
  },

  beginUpdate: (agentId, input) => {
    return get().startFreshUpdate(agentId, input);
  },

  beginAction: (operation, agentId) => {
    return get().startFreshAction(operation, agentId);
  },

  startFreshCreate: () => {
    const mutationId = newMutationId();
    set({
      session: {
        mutationId,
        operation: 'create',
        status: 'idle'
      }
    });
    return mutationId;
  },

  startFreshUpdate: (agentId, input) => {
    const mutationId = newMutationId();
    set({
      session: {
        mutationId,
        operation: 'update',
        agentId,
        updateInput: input,
        status: 'idle'
      }
    });
    return mutationId;
  },

  startFreshAction: (operation, agentId) => {
    const mutationId = newMutationId();
    set({
      session: {
        mutationId,
        operation,
        agentId,
        status: 'idle'
      }
    });
    return mutationId;
  },

  abandonAmbiguous: () => {
    set({ session: null });
  },

  markSubmitting: (mutationId) => {
    const session = get().session;
    if (!session || session.mutationId !== mutationId) return;
    set({ session: { ...session, status: 'submitting', error: undefined } });
  },

  markAmbiguous: (mutationId, error) => {
    const session = get().session;
    if (!session || session.mutationId !== mutationId) return;
    set({ session: { ...session, status: 'ambiguous', error } });
  },

  markApplied: (mutationId) => {
    const session = get().session;
    if (!session || session.mutationId !== mutationId) return;
    set({ session: { ...session, status: 'applied', error: undefined } });
  },

  markFailed: (mutationId, error) => {
    const session = get().session;
    if (!session || session.mutationId !== mutationId) return;
    set({ session: { ...session, status: 'failed', error } });
  },

  rotateAfterEdit: (mutationId, input) => {
    const session = get().session;
    if (!session || session.mutationId !== mutationId) return mutationId;
    if (session.status !== 'ambiguous') return mutationId;
    const nextId = newMutationId();
    set({
      session: {
        ...session,
        mutationId: nextId,
        status: 'idle',
        error: undefined,
        ...(session.operation === 'create' ? { createInput: input as CreateAgentInputDto } : {}),
        ...(session.operation === 'update' ? { updateInput: input as UpdateAgentInputDto } : {})
      }
    });
    return nextId;
  },

  clearSession: () => {
    set({ session: null });
  },

  createRequest: (mutationId, input) => {
    const session = get().session;
    if (!session || session.mutationId !== mutationId || session.operation !== 'create') return null;
    if (session.status === 'applied' || session.status === 'failed') return null;
    return { mutationId, input };
  },

  updateRequest: (mutationId, agentId, input) => {
    const session = get().session;
    if (!session || session.mutationId !== mutationId || session.operation !== 'update') return null;
    if (session.status === 'applied' || session.status === 'failed') return null;
    return { mutationId, agentId, input };
  },

  actionRequest: (mutationId, agentId) => {
    const session = get().session;
    if (!session || session.mutationId !== mutationId || !session.agentId) return null;
    if (session.agentId !== agentId) return null;
    if (session.status === 'applied' || session.status === 'failed') return null;
    return { mutationId, agentId };
  }
}));
