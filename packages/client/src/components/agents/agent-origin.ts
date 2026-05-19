import type { Agent, AgentOrigin } from '../../api/agents.ts'

export interface AgentOriginBadge {
  origin: AgentOrigin
  label: string
  title: string
  background: string
  color: string
  border: string
}

export function normalizeAgentOrigin(agent: Pick<Agent, 'origin' | 'agentKind'>): AgentOrigin {
  if (agent.origin) return agent.origin
  return agent.agentKind === 'copilot' ? 'virtual-copilot' : 'project'
}

export function isReadOnlyAgent(agent: Pick<Agent, 'origin' | 'agentKind' | 'readOnly'>): boolean {
  const origin = normalizeAgentOrigin(agent)
  return agent.readOnly === true || origin === 'human' || origin === 'virtual-copilot'
}

export function getAgentOriginBadge(agent: Pick<Agent, 'origin' | 'agentKind'>): AgentOriginBadge {
  const origin = normalizeAgentOrigin(agent)
  switch (origin) {
    case 'virtual-copilot':
      return {
        origin,
        label: 'Virtual Copilot',
        title: 'Virtual Copilot dispatcher',
        background: 'rgba(210,168,255,0.12)',
        color: '#d2a8ff',
        border: 'rgba(210,168,255,0.25)',
      }
    case 'human':
      return {
        origin,
        label: 'Human',
        title: 'Human team member',
        background: 'rgba(63,185,80,0.10)',
        color: '#56d364',
        border: 'rgba(63,185,80,0.25)',
      }
    case 'project':
    default:
      return {
        origin: 'project',
        label: 'Project agent',
        title: 'Project agent from .squad/agents',
        background: 'rgba(139,148,158,0.12)',
        color: 'var(--text-muted)',
        border: 'rgba(139,148,158,0.25)',
      }
  }
}
