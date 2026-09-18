import { useMemo, useState, type ReactNode } from 'react';
import type {
  AgentAuthorityDto,
  AgentDto,
  CreateAgentInputDto,
  ProjectDto,
  TaskComplexity,
  TaskRisk,
  UpdateAgentInputDto,
  ProviderRuntimeStatus
} from '@shared/agenthubTypes';
import {
  AGENT_AUTHORITIES,
  KNOWN_AGENT_PROVIDER_IDS,
  TASK_COMPLEXITIES,
  TASK_RISKS,
  formatProviderStatus,
  isProviderUsable
} from '@shared/agenthubTypes';
import modelCatalog from '@shared/modelCatalog.json';
import { ProviderLogo } from './ProviderLogo';
import type { AgentProvider } from '@/store/config';
import { useAgentHubStore } from '../stores/agentHubStore';

export const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  antigravity: 'Antigravity'
};

export { formatProviderStatus, isProviderUsable };

export interface AgentHubAgentFormValue {
  projectId: string | null;
  name: string;
  providerId: string;
  modelId: string;
  position: string;
  allowedComplexities: readonly TaskComplexity[];
  allowedRiskLevels: readonly TaskRisk[];
  capabilities: string;
  specialties: string;
  authority: AgentAuthorityDto;
  routingPriority: number;
  enabled: boolean;
}

export function emptyAgentFormValue(): AgentHubAgentFormValue {
  return {
    projectId: null,
    name: '',
    providerId: 'claude',
    modelId: '',
    position: '',
    allowedComplexities: ['SIMPLE'],
    allowedRiskLevels: ['LOW'],
    capabilities: '',
    specialties: '',
    authority: 'STANDARD',
    routingPriority: 1,
    enabled: true
  };
}

export function formFromAgent(agent: AgentDto): AgentHubAgentFormValue {
  return {
    projectId: agent.projectId,
    name: agent.name,
    providerId: agent.providerId,
    modelId: agent.modelId,
    position: agent.position,
    allowedComplexities: agent.allowedComplexities.filter((value): value is TaskComplexity =>
      (TASK_COMPLEXITIES as readonly string[]).includes(value)
    ),
    allowedRiskLevels: agent.allowedRiskLevels.filter((value): value is TaskRisk =>
      (TASK_RISKS as readonly string[]).includes(value)
    ),
    capabilities: agent.capabilities.join(', '),
    specialties: agent.specialties.join(', '),
    authority: (AGENT_AUTHORITIES as readonly string[]).includes(agent.authority)
      ? agent.authority as AgentAuthorityDto
      : 'STANDARD',
    routingPriority: agent.routingPriority,
    enabled: agent.enabled
  };
}

function splitList(raw: string): string[] {
  return raw.split(/[,;\n]/u).map((item) => item.trim()).filter((item) => item.length > 0);
}

export function toCreateInput(value: AgentHubAgentFormValue): CreateAgentInputDto {
  return {
    projectId: value.projectId,
    name: value.name,
    providerId: value.providerId,
    modelId: value.modelId,
    position: value.position,
    allowedComplexities: value.allowedComplexities,
    allowedRiskLevels: value.allowedRiskLevels,
    capabilities: splitList(value.capabilities),
    specialties: splitList(value.specialties),
    authority: value.authority,
    routingPriority: value.routingPriority,
    enabled: value.enabled
  };
}

export function toUpdateInput(value: AgentHubAgentFormValue): UpdateAgentInputDto {
  const created = toCreateInput(value);
  return {
    name: created.name,
    providerId: created.providerId,
    modelId: created.modelId,
    position: created.position,
    allowedComplexities: created.allowedComplexities,
    allowedRiskLevels: created.allowedRiskLevels,
    capabilities: created.capabilities,
    specialties: created.specialties,
    authority: created.authority,
    routingPriority: created.routingPriority
  };
}

function catalogModels(providerId: string): readonly { id?: string; label: string }[] {
  const providers = (modelCatalog as { providers?: Record<string, { id?: string; label: string }[]> }).providers;
  return providers?.[providerId] ?? [];
}

interface AgentHubAgentFormProps {
  mode: 'create' | 'edit';
  value: AgentHubAgentFormValue;
  projects: readonly ProjectDto[];
  disabled?: boolean;
  onChange: (next: AgentHubAgentFormValue) => void;
}

export function AgentHubAgentForm({
  mode,
  value,
  projects,
  disabled = false,
  onChange
}: AgentHubAgentFormProps) {
  const [manualModel, setManualModel] = useState(true);
  const providerCatalog = useAgentHubStore((s) => s.providerCatalog);

  const currentProviderDto = useMemo(
    () => providerCatalog?.find((p) => p.providerId === value.providerId) ?? null,
    [providerCatalog, value.providerId]
  );

  const { modelSuggestions, isOfflineFallback } = useMemo(() => {
    if (currentProviderDto && currentProviderDto.modelDiscovery === 'native' && currentProviderDto.models.length > 0) {
      return {
        modelSuggestions: currentProviderDto.models.map((m) => ({ id: m.modelId, label: m.label })),
        isOfflineFallback: false
      };
    }
    const fallback = catalogModels(value.providerId);
    return {
      modelSuggestions: fallback,
      isOfflineFallback: true
    };
  }, [currentProviderDto, value.providerId]);

  const isCurrentProviderUsable = currentProviderDto?.usable ?? false;
  const isKnownProvider = (KNOWN_AGENT_PROVIDER_IDS as readonly string[]).includes(value.providerId);

  const field = (label: string, children: ReactNode) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );

  const toggleEnum = <T extends string>(current: readonly T[], item: T): readonly T[] =>
    current.includes(item) ? current.filter((valueItem) => valueItem !== item) : [...current, item];

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {field('Name', (
        <input
          value={value.name}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      ))}
      {mode === 'create'
        ? field('Scope / Project', (
          <select
            value={value.projectId ?? ''}
            disabled={disabled}
            onChange={(event) => onChange({
              ...value,
              projectId: event.target.value === '' ? null : event.target.value
            })}
          >
            <option value="">Global</option>
            {projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>{project.name}</option>
            ))}
          </select>
        ))
        : field('Project Scope', (
          <input value={value.projectId ?? 'Global'} disabled />
        ))}
      {field('Provider', (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {KNOWN_AGENT_PROVIDER_IDS.map((id) => {
              const pDto = providerCatalog?.find((p) => p.providerId === id);
              const isSelected = value.providerId === id;
              const statusText = pDto ? formatProviderStatus(pDto.status) : null;
              const isUsable = pDto?.usable ?? false;

              return (
                <button
                  key={id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange({ ...value, providerId: id, modelId: '' })}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px',
                    border: isSelected ? '2px solid #0f172a' : '1px solid #cbd5e1',
                    background: isSelected ? '#d0f0e0' : '#fff',
                    cursor: disabled ? 'not-allowed' : 'pointer'
                  }}
                >
                  <ProviderLogo provider={id as AgentProvider} size={14} />
                  <span>{PROVIDER_LABELS[id] ?? id}</span>
                  {statusText && (
                    <span style={{
                      fontSize: 10,
                      padding: '1px 4px',
                      borderRadius: 3,
                      background: isUsable ? '#e2e8f0' : '#fed7aa',
                      color: isUsable ? '#334155' : '#9a3412'
                    }}>
                      {statusText}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {!isKnownProvider && (
            <div style={{ color: '#ea580c', fontWeight: 700, fontSize: 12 }}>
              Unsupported legacy provider — please migrate to Claude, Codex, Cursor, or Antigravity
            </div>
          )}
          {isKnownProvider && !isCurrentProviderUsable && (
            <div style={{ color: '#ea580c', fontWeight: 700, fontSize: 12 }}>
              Runtime provider unavailable{currentProviderDto ? ` (${formatProviderStatus(currentProviderDto.status)})` : ''}
            </div>
          )}
        </div>
      ))}
      {field('Model', (
        <div style={{ display: 'grid', gap: 6 }}>
          <select
            value={modelSuggestions.some((item) => item.id === value.modelId) ? value.modelId : ''}
            disabled={disabled}
            onChange={(event) => {
              setManualModel(event.target.value === '');
              if (event.target.value) onChange({ ...value, modelId: event.target.value });
            }}
          >
            <option value="">Manual modelId</option>
            {modelSuggestions.filter((item) => item.id).map((item) => (
              <option key={item.id} value={item.id}>{item.label} ({item.id})</option>
            ))}
          </select>
          <input
            value={value.modelId}
            disabled={disabled}
            placeholder="Exact modelId"
            onChange={(event) => {
              setManualModel(true);
              onChange({ ...value, modelId: event.target.value });
            }}
          />
          {isOfflineFallback && modelSuggestions.length > 0 && (
            <span style={{ color: '#ea580c', fontSize: 11 }}>Offline fallback — may be stale</span>
          )}
          {manualModel && (
            <span style={{ color: '#64748b', fontSize: 11 }}>
              Manual modelId is preserved exactly. Catalog rows are suggestions only.
            </span>
          )}
        </div>
      ))}
      {field('Position', (
        <input
          value={value.position}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, position: event.target.value })}
        />
      ))}
      {field('Allowed Complexities', (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TASK_COMPLEXITIES.map((item) => (
            <label key={item} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={value.allowedComplexities.includes(item)}
                onChange={() => onChange({ ...value, allowedComplexities: toggleEnum(value.allowedComplexities, item) })}
              />
              {item}
            </label>
          ))}
        </div>
      ))}
      {field('Allowed Risk Levels', (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TASK_RISKS.map((item) => (
            <label key={item} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={value.allowedRiskLevels.includes(item)}
                onChange={() => onChange({ ...value, allowedRiskLevels: toggleEnum(value.allowedRiskLevels, item) })}
              />
              {item}
            </label>
          ))}
        </div>
      ))}
      {field('Capabilities', (
        <input
          value={value.capabilities}
          disabled={disabled}
          placeholder="comma-separated"
          onChange={(event) => onChange({ ...value, capabilities: event.target.value })}
        />
      ))}
      {field('Specialties', (
        <input
          value={value.specialties}
          disabled={disabled}
          placeholder="comma-separated"
          onChange={(event) => onChange({ ...value, specialties: event.target.value })}
        />
      ))}
      {field('Authority', (
        <select
          value={value.authority}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, authority: event.target.value as AgentAuthorityDto })}
        >
          {AGENT_AUTHORITIES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      ))}
      {field('Routing Priority', (
        <input
          type="number"
          min={0}
          step={1}
          value={value.routingPriority}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, routingPriority: Number(event.target.value) })}
        />
      ))}
      {mode === 'create' && field('Enabled', (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={value.enabled && isCurrentProviderUsable}
              disabled={disabled || !isCurrentProviderUsable}
              onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
            />
            <span>Enable immediately</span>
          </label>
          {!isCurrentProviderUsable && (
            <span style={{ color: '#ea580c', fontSize: 11 }}>
              Provider is not usable — cannot create enabled agent
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
