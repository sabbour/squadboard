import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Now from '../Now'

const apiFetchMock = vi.hoisted(() => vi.fn())

vi.mock('../../api/client.ts', () => ({
  apiFetch: apiFetchMock,
}))

vi.mock('../../realtime/ws-client.ts', () => ({
  wsClient: {
    on: vi.fn(),
    off: vi.fn(),
    subscribeRoom: vi.fn(),
    unsubscribeRoom: vi.fn(),
  },
}))

function renderNow() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Now />
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  )
}

describe('Now Sweep Activity', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    apiFetchMock.mockImplementation((url: string) => {
      if (url === '/api/activity/now') {
        return Promise.resolve({
          liveSessions: [],
          issueRuns: [],
          workflowRuns: [],
        })
      }
      if (url === '/api/projects') {
        return Promise.resolve([])
      }
      if (url.startsWith('/api/heartbeat/status')) {
        return Promise.resolve({
          sweeps: [
            { id: 'stuck-issue-runs', label: 'Stuck Runs', description: '', scope: 'project' },
            { id: 'idle-live-sessions', label: 'Live Sessions', description: '', scope: 'project' },
          ],
          recent: { sweeps: [] },
        })
      }
      return Promise.reject(new Error(`unexpected apiFetch URL: ${url}`))
    })
  })

  it('renders every heartbeat lane on the actual Now page even when the status snapshot is partial', async () => {
    renderNow()

    expect(await screen.findByText('Ceremonies')).toBeInTheDocument()
    expect(screen.getByText('Workflow Steps')).toBeInTheDocument()
    expect(screen.getByText('Stuck Runs')).toBeInTheDocument()
    expect(screen.getByText('Presence')).toBeInTheDocument()
    expect(screen.getByText('Live Sessions')).toBeInTheDocument()
    expect(screen.getByText('GitHub Sync')).toBeInTheDocument()
    expect(screen.getByText('Ready Pickup')).toBeInTheDocument()
    expect(screen.getByText('Ralph Monitor')).toBeInTheDocument()
    expect(screen.getByText('Log Monitor')).toBeInTheDocument()
  })
})
