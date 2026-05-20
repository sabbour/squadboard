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

export function isInternalAgentFolder(agent: Partial<Pick<Agent, 'name' | 'charterPath'>>): boolean {
  if (agent.name?.startsWith('_')) return true

  const charterPath = agent.charterPath?.replace(/\\/g, '/')
  const agentFolder = charterPath?.match(/(?:^|\/)agents\/([^/]+)/)?.[1]
  return agentFolder?.startsWith('_') === true
}

export function isReadOnlyAgent(
  agent: Pick<Agent, 'origin' | 'agentKind' | 'readOnly'> & Partial<Pick<Agent, 'name' | 'charterPath'>>,
): boolean {
  const origin = normalizeAgentOrigin(agent)
  return agent.readOnly === true || origin === 'human' || origin === 'virtual-copilot' || isInternalAgentFolder(agent)
}

/**
 * Background/infrastructure agents (monitors, scribes, loggers) are valid
 * agents that run in the background but are not the natural first pick for a
 * direct "Start conversation" consult. They are not hidden — the user can
 * still select them — but the consult picker uses this to deprioritise them
 * during auto-selection.
 */
const BACKGROUND_ROLE_KEYWORDS = ['monitor', 'logger', 'observer', 'watcher', 'scribe', 'recorder']

export function isBackgroundAgent(agent: Pick<Agent, 'role'>): boolean {
  const role = agent.role.toLowerCase()
  return BACKGROUND_ROLE_KEYWORDS.some((kw) => role.includes(kw))
}

/**
 * Pick the best default conversational agent from a list.
 * Priority: lead/architect role > first non-background agent > first agent.
 */
export function pickDefaultConsultAgent(agents: Pick<Agent, 'id' | 'role'>[]): string | undefined {
  if (agents.length === 0) return undefined
  const lead = agents.find((a) => {
    const role = a.role.toLowerCase()
    return role.includes('lead') || role.includes('architect') || role.includes('coordinator')
  })
  if (lead) return lead.id
  const nonBg = agents.find((a) => !isBackgroundAgent(a))
  return (nonBg ?? agents[0]).id
}

export function getAgentOriginBadge(
  agent: Pick<Agent, 'origin' | 'agentKind'> & Partial<Pick<Agent, 'name' | 'charterPath'>>,
): AgentOriginBadge {
  if (isInternalAgentFolder(agent)) {
    return {
      origin: 'project',
      label: 'Internal folder',
      title: 'Internal .squad/agents housekeeping folder; read-only in Squadboard',
      background: 'rgba(139,148,158,0.12)',
      color: 'var(--text-muted)',
      border: 'rgba(139,148,158,0.25)',
    }
  }

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
