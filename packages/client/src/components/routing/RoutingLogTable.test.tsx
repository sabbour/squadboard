import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { RoutingLogTable } from './RoutingLogTable'
import type { RoutingLogEntry } from '../../api/routing'

function renderTable(entries: RoutingLogEntry[]) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <RoutingLogTable entries={entries} />
    </FluentProvider>,
  )
}

describe('RoutingLogTable', () => {
  it('shows the issue, tier, agent, and reasoning for a decision', () => {
    renderTable([{
      id: 'log-1',
      timestamp: '2026-05-20T04:06:00Z',
      issueId: 'issue-1',
      issueTitle: 'Clarify Routing',
      tier: 'T2',
      matchedRule: 'keyword-score',
      agentName: 'mcmanus',
      score: 0.42,
      reasoning: 'tier2 score=0.4200 keywords: [routing]',
    }])

    expect(screen.getByText('Clarify Routing')).toBeInTheDocument()
    expect(screen.getByText('T2')).toBeInTheDocument()
    expect(screen.getByText('Keyword')).toBeInTheDocument()
    expect(screen.getByText('mcmanus')).toBeInTheDocument()
    expect(screen.getByText(/tier2 score=0\.4200/)).toBeInTheDocument()
  })
})
