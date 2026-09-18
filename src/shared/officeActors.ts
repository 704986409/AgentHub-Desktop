import type { AgentDto } from './agenthubTypes';

/** Visual Office presence only. Never a business-authority discriminator. */
export type OfficePresenceKind = 'human' | 'agent';

export type OfficePresentationRole = 'human' | 'agent';

/**
 * Human Boss in the Office. This is the human user, not an AI, not Hive,
 * not Michael, not GOD, and not a Lead Agent.
 *
 * Authority: none. Visualization only.
 */
export interface HumanPresenceActor {
  readonly kind: 'human';
  readonly presentationId: 'human-boss';
  readonly presentationRole: 'human';
  readonly name: string;
}

/**
 * Lead / Specialist Agent projection. Must come from an AgentHub Agent DTO.
 */
export interface AgentPresenceActor {
  readonly kind: 'agent';
  readonly presentationRole: 'agent';
  readonly agentId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly status: string;
  readonly name: string;
}

export type OfficeActor = HumanPresenceActor | AgentPresenceActor;

export const HUMAN_BOSS_PRESENCE: HumanPresenceActor = Object.freeze({
  kind: 'human',
  presentationId: 'human-boss',
  presentationRole: 'human',
  name: 'Human Boss'
});

export function isHumanPresence(actor: OfficeActor): actor is HumanPresenceActor {
  return actor.kind === 'human';
}

export function agentPresenceFromDto(agent: AgentDto): AgentPresenceActor {
  return Object.freeze({
    kind: 'agent',
    presentationRole: 'agent',
    agentId: agent.agentId,
    providerId: agent.providerId,
    modelId: agent.modelId,
    status: agent.status,
    name: agent.name
  });
}

export function composeOfficeActors(agents: readonly AgentDto[] | null | undefined): readonly OfficeActor[] {
  const human: HumanPresenceActor = HUMAN_BOSS_PRESENCE;
  const agentActors = (agents ?? []).map(agentPresenceFromDto);
  return Object.freeze([human, ...agentActors]);
}

/**
 * Legacy Munder `isGod` is a visual/compatibility flag only.
 * It must never map to Human Boss or Lead Agent authority.
 */
export function legacyIsGodToPresentationRole(_isGod: boolean): 'legacy-visual-primary' | 'legacy-visual-agent' {
  return _isGod ? 'legacy-visual-primary' : 'legacy-visual-agent';
}
