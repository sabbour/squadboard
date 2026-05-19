import { describe, expect, it } from 'vitest'
import { getAgentOriginBadge, isReadOnlyAgent, normalizeAgentOrigin } from '../agent-origin.ts'

describe('agent origin helpers', () => {
  it('distinguishes project, virtual Copilot, and human origins', () => {
    expect(getAgentOriginBadge({ origin: 'project' }).label).toContain('Project')
    expect(getAgentOriginBadge({ origin: 'virtual-copilot' }).label).toContain('Virtual Copilot')
    expect(getAgentOriginBadge({ origin: 'human' }).label).toContain('Human')
  })

  it('falls back from legacy agentKind when origin is absent', () => {
    expect(normalizeAgentOrigin({ agentKind: 'copilot' })).toBe('virtual-copilot')
    expect(normalizeAgentOrigin({ agentKind: 'squad' })).toBe('project')
  })

  it('marks virtual Copilot and human members read-only', () => {
    expect(isReadOnlyAgent({ origin: 'virtual-copilot' })).toBe(true)
    expect(isReadOnlyAgent({ origin: 'human' })).toBe(true)
    expect(isReadOnlyAgent({ origin: 'project' })).toBe(false)
  })
})
