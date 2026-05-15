/**
 * AgentCapabilities — Phase 13 sub-pane shown inside AgentDetailPanel's
 * Capabilities tab. Three sections: Skills / Tools / MCP Servers, each
 * with assignment + unassignment + an "Assign…" modal that lets the user
 * pick from the project-scoped registries.
 */

import { useState } from 'react'
import { Link } from 'react-router'
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Subtitle2,
  tokens,
} from '@fluentui/react-components'
import {
  useAgentSkills,
  useAssignSkillsToAgent,
  useSkills,
  useUnassignSkillFromAgent,
} from '../../api/skills.ts'
import {
  useAgentTools,
  useAssignToolsToAgent,
  useTools,
  useUnassignToolFromAgent,
} from '../../api/tools.ts'
import {
  useAgentMcpServers,
  useAssignMcpServersToAgent,
  useMcpServers,
  useUnassignMcpServerFromAgent,
} from '../../api/mcp.ts'

interface AgentCapabilitiesProps {
  projectId: string
  agentId: string
}

export default function AgentCapabilities({ projectId, agentId }: AgentCapabilitiesProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <SkillsSection projectId={projectId} agentId={agentId} />
      <ToolsSection projectId={projectId} agentId={agentId} />
      <McpSection projectId={projectId} agentId={agentId} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

function SkillsSection({ projectId, agentId }: AgentCapabilitiesProps) {
  const { data: assigned = [], isLoading } = useAgentSkills(projectId, agentId)
  const { data: all = [] } = useSkills(projectId)
  const unassign = useUnassignSkillFromAgent(projectId, agentId)
  const [picking, setPicking] = useState(false)
  const assignedIds = new Set(assigned.map((s) => s.id))
  const available = all.filter((s) => !assignedIds.has(s.id))

  return (
    <section>
      <SectionHeader
        title="Skills"
        count={assigned.length}
        actionLabel="Assign skill"
        onAction={() => setPicking(true)}
        emptyHint={
          all.length === 0
            ? <>No skills exist in this project yet. <Link to={`/projects/${projectId}/skills`}>Create one →</Link></>
            : null
        }
      />
      {isLoading && <Caption1 style={{ color: 'var(--text-muted)' }}>Loading…</Caption1>}
      {!isLoading && assigned.length === 0 && (
        <EmptyState>No skills assigned. <a href={`/projects/${projectId}/skills`}>Manage registry →</a></EmptyState>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {assigned.map((s) => (
          <CapabilityRow
            key={s.id}
            primary={s.name}
            secondary={s.category ?? undefined}
            tertiary={s.description ?? undefined}
            onUnassign={() => unassign.mutate(s.id)}
          />
        ))}
      </div>
      {picking && (
        <PickerDialog
          title="Assign skills"
          items={available.map((s) => ({ id: s.id, label: s.name, hint: s.category ?? undefined }))}
          onClose={() => setPicking(false)}
          onConfirm={(ids) => ({ projectId, agentId, ids, kind: 'skills' as const })}
          projectId={projectId}
          agentId={agentId}
          kind="skills"
        />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function ToolsSection({ projectId, agentId }: AgentCapabilitiesProps) {
  const { data: assigned = [], isLoading } = useAgentTools(projectId, agentId)
  const { data: all = [] } = useTools(projectId)
  const unassign = useUnassignToolFromAgent(projectId, agentId)
  const [picking, setPicking] = useState(false)
  const assignedIds = new Set(assigned.map((t) => t.id))
  const available = all.filter((t) => !assignedIds.has(t.id))

  return (
    <section>
      <SectionHeader
        title="Tools"
        count={assigned.length}
        actionLabel="Assign tool"
        onAction={() => setPicking(true)}
        emptyHint={
          all.length === 0
            ? <>No tools exist in this project yet. <Link to={`/projects/${projectId}/tools`}>Create one →</Link></>
            : null
        }
      />
      {isLoading && <Caption1 style={{ color: 'var(--text-muted)' }}>Loading…</Caption1>}
      {!isLoading && assigned.length === 0 && (
        <EmptyState>No tools assigned. <a href={`/projects/${projectId}/tools`}>Manage registry →</a></EmptyState>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {assigned.map((t) => (
          <CapabilityRow
            key={t.id}
            primary={t.name}
            secondary={t.category ?? undefined}
            tertiary={t.description}
            onUnassign={() => unassign.mutate(t.id)}
          />
        ))}
      </div>
      {picking && (
        <PickerDialog
          title="Assign tools"
          items={available.map((t) => ({ id: t.id, label: t.name, hint: t.category ?? undefined }))}
          onClose={() => setPicking(false)}
          onConfirm={(ids) => ({ projectId, agentId, ids, kind: 'tools' as const })}
          projectId={projectId}
          agentId={agentId}
          kind="tools"
        />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// MCP Servers
// ---------------------------------------------------------------------------

function McpSection({ projectId, agentId }: AgentCapabilitiesProps) {
  const { data: assigned = [], isLoading } = useAgentMcpServers(projectId, agentId)
  const { data: all = [] } = useMcpServers(projectId)
  const unassign = useUnassignMcpServerFromAgent(projectId, agentId)
  const [picking, setPicking] = useState(false)
  const assignedIds = new Set(assigned.map((s) => s.id))
  const available = all.filter((s) => !assignedIds.has(s.id))

  return (
    <section>
      <SectionHeader
        title="MCP Servers"
        count={assigned.length}
        actionLabel="Assign server"
        onAction={() => setPicking(true)}
        emptyHint={
          all.length === 0
            ? <>No MCP servers configured. <Link to={`/projects/${projectId}/mcp-servers`}>Add one →</Link></>
            : null
        }
      />
      {isLoading && <Caption1 style={{ color: 'var(--text-muted)' }}>Loading…</Caption1>}
      {!isLoading && assigned.length === 0 && (
        <EmptyState>No MCP servers assigned. <a href={`/projects/${projectId}/mcp-servers`}>Manage registry →</a></EmptyState>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {assigned.map((s) => (
          <CapabilityRow
            key={s.id}
            primary={s.name}
            secondary={`${s.transport} • ${s.headers.length} header${s.headers.length === 1 ? '' : 's'}`}
            tertiary={s.description ?? undefined}
            badge={s.enabled ? <Badge appearance="outline" color="success" size="extra-small">enabled</Badge> : <Badge appearance="outline" color="subtle" size="extra-small">disabled</Badge>}
            onUnassign={() => unassign.mutate(s.id)}
          />
        ))}
      </div>
      {picking && (
        <PickerDialog
          title="Assign MCP servers"
          items={available.map((s) => ({ id: s.id, label: s.name, hint: s.transport }))}
          onClose={() => setPicking(false)}
          onConfirm={(ids) => ({ projectId, agentId, ids, kind: 'mcp' as const })}
          projectId={projectId}
          agentId={agentId}
          kind="mcp"
        />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function SectionHeader({
  title, count, actionLabel, onAction, emptyHint,
}: {
  title: string
  count: number
  actionLabel: string
  onAction: () => void
  emptyHint: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
      <div>
        <Subtitle2 style={{ display: 'inline' }}>{title}</Subtitle2>
        <Caption1 style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>{count}</Caption1>
        {emptyHint && (
          <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>{emptyHint}</div>
        )}
      </div>
      <Button size="small" appearance="subtle" onClick={onAction}>+ {actionLabel}</Button>
    </div>
  )
}

function CapabilityRow({
  primary, secondary, tertiary, badge, onUnassign,
}: {
  primary: string
  secondary?: string
  tertiary?: string
  badge?: React.ReactNode
  onUnassign: () => void
}) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 12px',
      background: 'var(--bg)', display: 'flex', gap: '12px', alignItems: 'flex-start',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>{primary}</span>
          {badge}
        </div>
        {secondary && (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{secondary}</div>
        )}
        {tertiary && (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{tertiary}</div>
        )}
      </div>
      <Button size="small" appearance="subtle" onClick={onUnassign}>Remove</Button>
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '12px', color: 'var(--text-muted)', padding: '12px',
      border: '1px dashed var(--border)', borderRadius: '6px', textAlign: 'center',
    }}>{children}</div>
  )
}

interface PickerItem { id: string; label: string; hint?: string }

function PickerDialog({
  title, items, onClose, projectId, agentId, kind,
}: {
  title: string
  items: PickerItem[]
  onClose: () => void
  onConfirm: (ids: string[]) => unknown
  projectId: string
  agentId: string
  kind: 'skills' | 'tools' | 'mcp'
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const assignSkills = useAssignSkillsToAgent(projectId, agentId)
  const assignTools = useAssignToolsToAgent(projectId, agentId)
  const assignMcp = useAssignMcpServersToAgent(projectId, agentId)

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function submit() {
    const ids = Array.from(selected)
    if (ids.length === 0) { onClose(); return }
    const onSuccess = () => onClose()
    if (kind === 'skills') assignSkills.mutate(ids, { onSuccess })
    else if (kind === 'tools') assignTools.mutate(ids, { onSuccess })
    else assignMcp.mutate(ids, { onSuccess })
  }
  const pending = assignSkills.isPending || assignTools.isPending || assignMcp.isPending

  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose() }}>
      <DialogSurface style={{ maxWidth: '480px', width: '100%' }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            {items.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                Nothing left to assign — every available item is already in this list.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '4px' }}>
                {items.map((it) => (
                  <label key={it.id} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '6px 8px', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer',
                    background: selected.has(it.id) ? tokens.colorBrandBackground2 : undefined,
                  }}>
                    <Checkbox checked={selected.has(it.id)} onChange={() => toggle(it.id)} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '13px', color: 'var(--text)' }}>{it.label}</div>
                      {it.hint && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{it.hint}</div>}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Cancel</Button>
            <Button appearance="primary" onClick={submit} disabled={selected.size === 0 || pending}>
              {pending ? 'Assigning…' : `Assign ${selected.size}`}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
