/**
 * Inbox page — Phase 14 cross-project quick-capture review.
 *
 * Lists every InboxItem grouped by status (Captured / Formulated / Published
 * / Discarded). Each row shows: the original draft (truncated), the
 * formulated title (if any), the suggested project name, a status badge,
 * and an "Open" button that re-opens the CaptureModal pre-loaded with the
 * existing item.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { tokens } from '@fluentui/react-components'
import { Open16Regular } from '@fluentui/react-icons'
import { useInboxItems, type InboxItem, type InboxStatus } from '../api/inbox.ts'
import { useProjects } from '../api/projects.ts'
import CaptureModal from '../components/inbox/CaptureModal.tsx'

const STATUS_GROUPS: { status: InboxStatus; label: string; tone: string }[] = [
  { status: 'captured', label: 'Captured', tone: '#6e7681' },
  { status: 'formulated', label: 'Formulated', tone: '#388bfd' },
  { status: 'published', label: 'Published', tone: '#238636' },
  { status: 'discarded', label: 'Discarded', tone: '#8b949e' },
]

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

export default function Inbox() {
  const navigate = useNavigate()
  const { data: items = [], isLoading } = useInboxItems()
  const { data: projects = [] } = useProjects()
  const [editingId, setEditingId] = useState<string | null>(null)

  const projectName = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects) map.set(p.id, p.name)
    return (id: string | null) => (id ? map.get(id) ?? '(unknown project)' : '—')
  }, [projects])

  const grouped = useMemo(() => {
    const map = new Map<InboxStatus, InboxItem[]>()
    for (const g of STATUS_GROUPS) map.set(g.status, [])
    for (const item of items) {
      const list = map.get(item.status) ?? []
      list.push(item)
      map.set(item.status, list)
    }
    return map
  }, [items])

  return (
    <div style={{ padding: '24px', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: tokens.colorNeutralForeground1, margin: 0 }}>
            Inbox
          </h1>
          <p style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, margin: '4px 0 0' }}>
            Quick captures across every project — review, edit, and publish to a board when ready.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            borderRadius: '6px',
            color: tokens.colorNeutralForeground1,
            padding: '6px 14px',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          ← Projects
        </button>
      </div>

      {isLoading && (
        <div style={{ color: tokens.colorNeutralForeground3, padding: '32px', textAlign: 'center' }}>
          Loading inbox…
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div
          style={{
            color: tokens.colorNeutralForeground3,
            padding: '48px',
            textAlign: 'center',
            border: `1px dashed ${tokens.colorNeutralStroke2}`,
            borderRadius: '8px',
          }}
        >
          <p style={{ margin: 0, fontSize: '14px' }}>Your inbox is empty.</p>
          <p style={{ margin: '8px 0 0', fontSize: '12px' }}>
            Press <kbd style={kbdStyle}>c</kbd> anywhere to capture an idea.
          </p>
        </div>
      )}

      {!isLoading &&
        STATUS_GROUPS.map((group) => {
          const list = grouped.get(group.status) ?? []
          if (list.length === 0) return null
          return (
            <section key={group.status} style={{ marginBottom: '24px' }}>
              <h2
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: tokens.colorNeutralForeground2,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  margin: '0 0 8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span
                  style={{
                    background: group.tone,
                    color: '#fff',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    fontSize: '11px',
                  }}
                >
                  {group.label}
                </span>
                <span style={{ fontSize: '11px', color: tokens.colorNeutralForeground3 }}>
                  {list.length} item{list.length === 1 ? '' : 's'}
                </span>
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {list.map((item) => (
                  <article
                    key={item.id}
                    style={{
                      border: `1px solid ${tokens.colorNeutralStroke1}`,
                      borderRadius: '8px',
                      padding: '12px 16px',
                      background: tokens.colorNeutralBackground1,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {item.formulatedTitle && (
                        <div
                          style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            color: tokens.colorNeutralForeground1,
                            marginBottom: '4px',
                          }}
                        >
                          {item.formulatedTitle}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: '12px',
                          color: tokens.colorNeutralForeground2,
                          marginBottom: '6px',
                          lineHeight: '1.4',
                        }}
                      >
                        {truncate(item.originalDraft, 200)}
                      </div>
                      <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: tokens.colorNeutralForeground3 }}>
                        <span>📁 {projectName(item.suggestedProjectId)}</span>
                        {item.suggestedColumn && <span>↳ {item.suggestedColumn}</span>}
                        {item.confidence && <span>· {item.confidence} confidence</span>}
                        <span>· {new Date(item.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    {item.status !== 'discarded' && item.status !== 'published' && (
                      <button
                        type="button"
                        onClick={() => setEditingId(item.id)}
                        style={{
                          background: 'none',
                          border: `1px solid ${tokens.colorNeutralStroke1}`,
                          borderRadius: '6px',
                          color: tokens.colorNeutralForeground1,
                          padding: '4px 10px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          flexShrink: 0,
                        }}
                      >
                        <Open16Regular /> Open
                      </button>
                    )}
                    {item.status === 'published' && item.publishedIssueId && item.suggestedProjectId && (
                      <button
                        type="button"
                        onClick={() => navigate(`/projects/${item.suggestedProjectId}/board`)}
                        style={{
                          background: 'none',
                          border: `1px solid ${tokens.colorNeutralStroke1}`,
                          borderRadius: '6px',
                          color: tokens.colorNeutralForeground1,
                          padding: '4px 10px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        View on board →
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )
        })}

      <CaptureModal
        open={Boolean(editingId)}
        onClose={() => setEditingId(null)}
        existingItemId={editingId}
      />
    </div>
  )
}

const kbdStyle: React.CSSProperties = {
  background: tokens.colorNeutralBackground3,
  border: `1px solid ${tokens.colorNeutralStroke1}`,
  borderRadius: '4px',
  padding: '1px 5px',
  fontFamily: 'monospace',
  fontSize: '11px',
}
