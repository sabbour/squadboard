/**
 * Skills page — Phase 13 project-scoped skills registry.
 *
 * Lists every skill in the project, grouped by category. Each row supports
 * inline edit + delete. A "Browse curated" modal exposes the bundled
 * library so users can clone starter skills into the project. A "New skill"
 * modal supports authoring a custom skill from scratch.
 *
 * Skills surface their `promptAddendum` to assigned agents — the editor
 * shows it as a multiline textarea so users can see the prompt fragment
 * that will be injected into the agent's system prompt.
 */

import { useState } from 'react'
import { useParams } from 'react-router'
import {
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Subtitle1,
  Textarea,
  tokens,
} from '@fluentui/react-components'
import { useProject } from '../api/projects.ts'
import {
  useCloneCuratedSkill,
  useCreateSkill,
  useCuratedSkills,
  useDeleteSkill,
  useSkills,
  useUpdateSkill,
  type Skill,
  type CuratedSkill,
} from '../api/skills.ts'

const KEBAB_RE = /^[a-z][a-z0-9-]*$/

interface FormState {
  key: string
  name: string
  description: string
  category: string
  promptAddendum: string
}

const EMPTY_FORM: FormState = { key: '', name: '', description: '', category: '', promptAddendum: '' }

export default function Skills() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? ''
  const { data: project } = useProject(projectId)
  const { data: skills = [], isLoading } = useSkills(projectId)
  const deleteSkill = useDeleteSkill(projectId)

  const [showCreate, setShowCreate] = useState(false)
  const [showCurated, setShowCurated] = useState(false)
  const [editing, setEditing] = useState<Skill | null>(null)

  const grouped = skills.reduce<Map<string, Skill[]>>((acc, s) => {
    const key = s.category ?? 'other'
    if (!acc.has(key)) acc.set(key, [])
    acc.get(key)!.push(s)
    return acc
  }, new Map())

  function confirmDelete(s: Skill) {
    if (!window.confirm(`Delete skill "${s.name}"? It will be unassigned from any agents.`)) return
    deleteSkill.mutate(s.id)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div>
          <Subtitle1 as="h1">{project?.name ?? '…'} — Skills</Subtitle1>
          <Caption1 style={{ color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
            Prompt-augmentation snippets agents can be assigned to specialise their behaviour.
          </Caption1>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button appearance="secondary" onClick={() => setShowCurated(true)}>Browse curated</Button>
          <Button appearance="primary" onClick={() => setShowCreate(true)}>New skill</Button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', maxWidth: '1100px', width: '100%', margin: '0 auto' }}>
        {isLoading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
        {!isLoading && skills.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '14px', marginBottom: '12px' }}>No skills yet.</p>
            <Button appearance="secondary" onClick={() => setShowCurated(true)}>Browse the curated library</Button>
          </div>
        )}
        {Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
          <section key={cat} style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>
              {cat}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map((s) => (
                <SkillRow key={s.id} skill={s} onEdit={() => setEditing(s)} onDelete={() => confirmDelete(s)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {showCreate && <SkillFormDialog projectId={projectId} onClose={() => setShowCreate(false)} />}
      {editing && (
        <SkillFormDialog
          projectId={projectId}
          skill={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {showCurated && (
        <CuratedDialog
          projectId={projectId}
          existingKeys={new Set(skills.map((s) => s.key))}
          onClose={() => setShowCurated(false)}
        />
      )}
    </div>
  )
}

function SkillRow({ skill, onEdit, onDelete }: { skill: Skill; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: '6px', padding: '12px 16px',
      background: 'var(--surface)', display: 'flex', gap: '16px', alignItems: 'flex-start',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>{skill.name}</span>
          <code style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'ui-monospace,monospace' }}>{skill.key}</code>
          {skill.curatedKey && (
            <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '8px', background: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1 }}>curated</span>
          )}
        </div>
        {skill.description && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 6px' }}>{skill.description}</p>
        )}
        <details style={{ fontSize: '12px' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>Prompt addendum</summary>
          <pre style={{
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '4px',
            padding: '8px', marginTop: '6px', fontSize: '11px', color: 'var(--text)',
            whiteSpace: 'pre-wrap', maxHeight: '200px', overflow: 'auto',
          }}>{skill.promptAddendum}</pre>
        </details>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <Button appearance="subtle" size="small" onClick={onEdit}>Edit</Button>
        <Button appearance="subtle" size="small" onClick={onDelete}>Delete</Button>
      </div>
    </div>
  )
}

function SkillFormDialog({ projectId, skill, onClose }: { projectId: string; skill?: Skill; onClose: () => void }) {
  const [form, setForm] = useState<FormState>(
    skill
      ? {
          key: skill.key,
          name: skill.name,
          description: skill.description ?? '',
          category: skill.category ?? '',
          promptAddendum: skill.promptAddendum,
        }
      : EMPTY_FORM,
  )
  const [keyError, setKeyError] = useState('')
  const create = useCreateSkill(projectId)
  const update = useUpdateSkill(projectId)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!KEBAB_RE.test(form.key)) {
      setKeyError('Must be kebab-case: lowercase letters, digits, hyphens')
      return
    }
    if (skill) {
      update.mutate(
        { id: skill.id, ...form, description: form.description || null, category: form.category || null },
        { onSuccess: onClose },
      )
    } else {
      create.mutate(
        { ...form, description: form.description || null, category: form.category || null },
        { onSuccess: onClose },
      )
    }
  }

  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose() }}>
      <DialogSurface style={{ maxWidth: '640px', width: '100%' }}>
        <DialogBody>
          <DialogTitle>{skill ? 'Edit skill' : 'New skill'}</DialogTitle>
          <DialogContent>
            <form id="skill-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
              <Field label="Key (kebab-case)" validationMessage={keyError || undefined} validationState={keyError ? 'error' : 'none'}>
                <Input
                  value={form.key}
                  disabled={!!skill}
                  onChange={(e) => { setForm({ ...form, key: e.target.value }); setKeyError('') }}
                  placeholder="e.g. code-review-checklist"
                />
              </Field>
              <Field label="Name">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Code Review Checklist" />
              </Field>
              <Field label="Category (optional)">
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. review" />
              </Field>
              <Field label="Description (optional)">
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short summary" />
              </Field>
              <Field label="Prompt addendum" hint="Injected into the agent's system prompt when this skill is assigned.">
                <Textarea
                  value={form.promptAddendum}
                  onChange={(_, d) => setForm({ ...form, promptAddendum: d.value })}
                  rows={8}
                  placeholder="When the user asks for X, do Y…"
                />
              </Field>
            </form>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Cancel</Button>
            <Button
              appearance="primary"
              type="submit"
              form="skill-form"
              disabled={!form.key || !form.name || !form.promptAddendum || create.isPending || update.isPending}
            >
              {create.isPending || update.isPending ? 'Saving…' : skill ? 'Save' : 'Create'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

function CuratedDialog({ projectId, existingKeys, onClose }: { projectId: string; existingKeys: Set<string>; onClose: () => void }) {
  const { data: curated = [], isLoading } = useCuratedSkills()
  const clone = useCloneCuratedSkill(projectId)
  const [working, setWorking] = useState<string | null>(null)

  function handleClone(c: CuratedSkill) {
    setWorking(c.key)
    clone.mutate(c.key, { onSettled: () => setWorking(null) })
  }

  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose() }}>
      <DialogSurface style={{ maxWidth: '720px', width: '100%' }}>
        <DialogBody>
          <DialogTitle>Curated skills library</DialogTitle>
          <DialogContent>
            {isLoading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
              {curated.map((c) => {
                const installed = existingKeys.has(c.key)
                return (
                  <div key={c.key} style={{
                    border: '1px solid var(--border)', borderRadius: '6px', padding: '12px',
                    display: 'flex', gap: '12px', alignItems: 'flex-start',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <strong style={{ color: 'var(--text)' }}>{c.name}</strong>
                        <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '8px', background: 'var(--bg)', color: 'var(--text-muted)' }}>{c.category}</span>
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0' }}>{c.description}</p>
                    </div>
                    <Button
                      size="small"
                      appearance={installed ? 'subtle' : 'primary'}
                      disabled={installed || working === c.key}
                      onClick={() => handleClone(c)}
                    >
                      {installed ? 'Installed' : working === c.key ? 'Cloning…' : 'Clone'}
                    </Button>
                  </div>
                )
              })}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
