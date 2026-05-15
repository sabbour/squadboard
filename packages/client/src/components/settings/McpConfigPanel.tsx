import { useEffect, useState } from 'react'
import { useProject } from '../../api/projects.ts'

// Phase 18: tool descriptions are looked up here for display, but the
// authoritative tool *list* is fetched live from the server's /mcp/health
// probe so the panel never drifts from what the MCP server actually exports.
const TOOL_DESCRIPTIONS: Record<string, string> = {
  list_issues: 'List issues on the board, with an optional column-status filter.',
  create_issue: 'Create a new card on the board with title, body, and labels.',
  update_issue: "Update an existing issue's title, body, column, assignee, or labels.",
  list_agents: 'List active agents in the squad with their role and status.',
  run_agent: 'Trigger an agent run on a specific issue.',
  get_run_status: 'Fetch the status, output, and cost of an issue run by ID.',
  slash_command: 'Execute a /squadboard slash command and get a markdown response.',
}

interface McpHealth {
  ok: boolean
  transport: string
  sdkVersion: string
  tools: string[]
  sessions?: number
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; latencyMs: number; sdkVersion: string; toolCount: number }
  | { kind: 'error'; message: string; hint?: string }

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      style={{
        background: copied ? 'rgba(63,185,80,0.12)' : 'var(--bg)',
        border: `1px solid ${copied ? 'rgba(63,185,80,0.4)' : 'var(--border)'}`,
        color: copied ? '#3fb950' : 'var(--text-muted)',
        borderRadius: '6px',
        padding: '4px 10px',
        fontSize: '11px',
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

function Accordion({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          background: 'var(--bg)',
          border: 'none',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          color: 'var(--text)',
          padding: '10px 14px',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && (
        <div style={{ padding: '14px', background: 'var(--surface)', fontSize: '13px', color: 'var(--text)', lineHeight: '1.7' }}>
          {children}
        </div>
      )}
    </div>
  )
}

interface McpConfigPanelProps {
  projectId: string
}

export function McpConfigPanel({ projectId }: McpConfigPanelProps) {
  const { data: project } = useProject(projectId)
  const serverUrl = `${window.location.protocol}//${window.location.hostname}:3000`
  const healthUrl = `${serverUrl}/mcp/health`

  const [health, setHealth] = useState<McpHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false
    fetch(healthUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const ct = res.headers.get('content-type') ?? ''
        if (!ct.includes('application/json')) {
          throw new Error('non-JSON response — /mcp HTTP transport may not be mounted on this server')
        }
        return res.json() as Promise<McpHealth>
      })
      .then((body) => {
        if (!cancelled) setHealth(body)
      })
      .catch((err: unknown) => {
        if (!cancelled) setHealthError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [healthUrl])

  async function handleTestConnection() {
    setTestState({ kind: 'pending' })
    const startedAt = performance.now()
    try {
      const res = await fetch(healthUrl)
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        setTestState({
          kind: 'error',
          message: `HTTP ${res.status}`,
          hint: body.slice(0, 160) || 'The /mcp/health endpoint did not respond. Is the server running?',
        })
        return
      }
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('application/json')) {
        setTestState({
          kind: 'error',
          message: 'Non-JSON response',
          hint: 'The /mcp HTTP transport is not mounted on this server. Restart the Squadboard server to pick up the latest build.',
        })
        return
      }
      const body = (await res.json()) as McpHealth
      setHealth(body)
      setTestState({
        kind: 'ok',
        latencyMs: Math.round(performance.now() - startedAt),
        sdkVersion: body.sdkVersion,
        toolCount: body.tools.length,
      })
    } catch (err) {
      setTestState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        hint: 'Could not reach the server. Confirm Squadboard is running on port 3000 and reachable from this browser.',
      })
    }
  }

  const tools = health?.tools ?? Object.keys(TOOL_DESCRIPTIONS)
  const toolsSource: 'live' | 'fallback' = health ? 'live' : 'fallback'

  const httpConfig = {
    mcpServers: {
      squadboard: {
        url: `${serverUrl}/mcp`,
        headers: {
          'x-project-id': projectId,
        },
      },
    },
  }
  const httpConfigJson = JSON.stringify(httpConfig, null, 2)

  const vscodeConfig = {
    servers: {
      squadboard: {
        type: 'http',
        url: `${serverUrl}/mcp`,
        headers: {
          'x-project-id': projectId,
        },
      },
    },
  }
  const vscodeConfigJson = JSON.stringify(vscodeConfig, null, 2)

  const stdioConfig = {
    mcpServers: {
      squadboard: {
        command: 'squadboard',
        args: ['mcp'],
      },
    },
  }
  const stdioConfigJson = JSON.stringify(stdioConfig, null, 2)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Config block + Test button */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
            Add this to your AI client&apos;s MCP configuration (HTTP transport):
          </p>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button
              onClick={handleTestConnection}
              disabled={testState.kind === 'pending'}
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '11px',
                cursor: testState.kind === 'pending' ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {testState.kind === 'pending' ? 'Testing…' : 'Test connection'}
            </button>
            <CopyButton text={httpConfigJson} />
          </div>
        </div>
        <pre
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '14px',
            fontSize: '12px',
            color: 'var(--text)',
            overflowX: 'auto',
            margin: 0,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            lineHeight: '1.6',
          }}
        >
          {httpConfigJson}
        </pre>

        {/* Connection status */}
        {testState.kind === 'ok' && (
          <div
            style={{
              marginTop: '8px',
              padding: '8px 12px',
              border: '1px solid rgba(63,185,80,0.4)',
              background: 'rgba(63,185,80,0.08)',
              color: '#3fb950',
              borderRadius: '6px',
              fontSize: '12px',
            }}
          >
            ✓ Connected — {testState.toolCount} tools advertised, SDK v{testState.sdkVersion}, {testState.latencyMs} ms.
          </div>
        )}
        {testState.kind === 'error' && (
          <div
            style={{
              marginTop: '8px',
              padding: '8px 12px',
              border: '1px solid rgba(248,81,73,0.4)',
              background: 'rgba(248,81,73,0.08)',
              color: '#f85149',
              borderRadius: '6px',
              fontSize: '12px',
            }}
          >
            <div>✗ {testState.message}</div>
            {testState.hint && (
              <div style={{ marginTop: '4px', color: 'var(--text-muted)', fontSize: '11px' }}>{testState.hint}</div>
            )}
          </div>
        )}
        {testState.kind === 'idle' && healthError && !health && (
          <div
            style={{
              marginTop: '8px',
              padding: '8px 12px',
              border: '1px solid rgba(248,81,73,0.4)',
              background: 'rgba(248,81,73,0.08)',
              color: '#f85149',
              borderRadius: '6px',
              fontSize: '12px',
            }}
          >
            ✗ Could not reach <code>/mcp/health</code>: {healthError}
          </div>
        )}
      </div>

      {/* How to connect */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, fontWeight: 600 }}>
          How to connect
        </p>

        <Accordion title="VS Code (Insiders)">
          <p style={{ marginTop: 0 }}>
            VS Code Insiders speaks MCP over <em>Streamable HTTP</em>. Save the snippet below to{' '}
            <code>.vscode/mcp.json</code> at your workspace root, or paste the inner <code>servers</code> block under{' '}
            <code>mcp.servers</code> in user settings.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6px' }}>
            <CopyButton text={vscodeConfigJson} />
          </div>
          <pre
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '12px',
              fontSize: '12px',
              color: 'var(--text)',
              overflowX: 'auto',
              margin: 0,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              lineHeight: '1.6',
            }}
          >
            {vscodeConfigJson}
          </pre>
          <ol style={{ marginTop: '12px', paddingLeft: '20px' }}>
            <li>Open the VS Code Insiders Command Palette → <em>MCP: List Servers</em> to confirm Squadboard appears.</li>
            <li>Open Copilot Chat in agent mode and start a turn — Squadboard tools become available automatically.</li>
            <li>If a tool call fails, hit <em>Test connection</em> above to confirm the HTTP endpoint is reachable.</li>
          </ol>
        </Accordion>

        <Accordion title="Claude Desktop">
          <ol style={{ margin: 0, paddingLeft: '20px' }}>
            <li>Open <strong>Claude Desktop</strong> → Settings → Developer → MCP Servers.</li>
            <li>Click <em>Edit Config</em> and paste the JSON block above into <code>claude_desktop_config.json</code>.</li>
            <li>Restart Claude Desktop.</li>
            <li>In any conversation, type <code>/mcp squadboard</code> to verify the connection, then ask Claude to manage your board.</li>
          </ol>
        </Accordion>

        <Accordion title="Cursor">
          <ol style={{ margin: 0, paddingLeft: '20px' }}>
            <li>Open <strong>Cursor</strong> → Settings → MCP Servers → Add Server.</li>
            <li>Set <strong>Type</strong> to <em>HTTP</em> and paste the URL: <code>{serverUrl}/mcp</code>.</li>
            <li>Add header <code>x-project-id</code> with value <code>{projectId}</code>.</li>
            <li>Save and reload — Squadboard tools will appear in the Agent tool list.</li>
          </ol>
        </Accordion>

        <Accordion title="Standalone (stdio)">
          <p style={{ marginTop: 0 }}>
            Squadboard can also launch as a child process over stdin/stdout — no running web app required. Use this for
            offline / single-user setups, or for hosts that don&apos;t support Streamable HTTP yet.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6px' }}>
            <CopyButton text={stdioConfigJson} />
          </div>
          <pre
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '12px',
              fontSize: '12px',
              color: 'var(--text)',
              overflowX: 'auto',
              margin: 0,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              lineHeight: '1.6',
            }}
          >
            {stdioConfigJson}
          </pre>
          <p style={{ marginTop: '12px', marginBottom: 0 }}>
            <strong>Trade-offs:</strong> the stdio child process opens its own embedded Postgres connection but cannot
            scope to a specific project at connect time — pass <code>projectId</code> as a tool argument instead of a
            header.
          </p>
        </Accordion>
      </div>

      {/* Available tools */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, fontWeight: 600 }}>
            Available MCP Tools ({tools.length})
          </p>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {toolsSource === 'live' ? '· live from /mcp/health' : '· fallback (server unreachable)'}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {tools.map((name) => (
            <div
              key={name}
              style={{
                display: 'flex',
                gap: '12px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '8px 12px',
                alignItems: 'flex-start',
              }}
            >
              <code style={{ fontSize: '12px', color: '#58a6ff', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', flexShrink: 0 }}>
                {name}
              </code>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                {TOOL_DESCRIPTIONS[name] ?? '(no description available)'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Project info */}
      {project && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
          Project: <strong style={{ color: 'var(--text)' }}>{project.name}</strong> · ID:{' '}
          <code style={{ fontFamily: 'monospace' }}>{projectId}</code>
        </div>
      )}
    </div>
  )
}
