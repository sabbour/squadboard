import { useState } from 'react'
import { useProject } from '../../api/projects.ts'

const MCP_TOOLS = [
  { name: 'list_issues', description: 'List issues on the board, with optional column/label filters.' },
  { name: 'create_issue', description: 'Create a new card on the board with title, body, and labels.' },
  { name: 'update_issue', description: "Update an existing issue's title, body, column, or assignee." },
  { name: 'list_agents', description: 'List all agents in the squad with their role and status.' },
  { name: 'start_run', description: 'Trigger an agent run on a specific issue.' },
  { name: 'get_run_status', description: 'Fetch the status and output of an issue run by ID.' },
]

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

function Accordion({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
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

  const mcpConfig = {
    mcpServers: {
      squadboard: {
        url: `${serverUrl}/mcp`,
        headers: {
          'x-project-id': projectId,
        },
      },
    },
  }

  const configJson = JSON.stringify(mcpConfig, null, 2)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Config block */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}
        >
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
            Add this to your AI client's MCP configuration:
          </p>
          <CopyButton text={configJson} />
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
          {configJson}
        </pre>
      </div>

      {/* How to connect */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, fontWeight: 600 }}>
          How to connect
        </p>
        <Accordion title="Claude Desktop">
          <ol style={{ margin: 0, paddingLeft: '20px' }}>
            <li>Open <strong>Claude Desktop</strong> → Settings → Developer → MCP Servers.</li>
            <li>Click <em>Edit Config</em> and paste the JSON block above into <code>claude_desktop_config.json</code>.</li>
            <li>Restart Claude Desktop.</li>
            <li>In any conversation, type <code>/mcp squadboard</code> to verify the connection, then use <code>/issue list</code> or ask Claude to manage your board.</li>
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
      </div>

      {/* Available tools */}
      <div>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', fontWeight: 600 }}>
          Available MCP Tools ({MCP_TOOLS.length})
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {MCP_TOOLS.map((tool) => (
            <div
              key={tool.name}
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
                {tool.name}
              </code>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>{tool.description}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Project info */}
      {project && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
          Project: <strong style={{ color: 'var(--text)' }}>{project.name}</strong> · ID: <code style={{ fontFamily: 'monospace' }}>{projectId}</code>
        </div>
      )}
    </div>
  )
}
