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
  Body1,
  Body1Strong,
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
  Textarea,
  tokens,
} from '@fluentui/react-components'
import { useProject } from '../api/projects.ts'
import {
  useCloneCuratedSkill,
  useCreateSkill,
  useCuratedSkills,
  useDeleteSkill,
  useFormulateSkill,
  useSkills,
  useUpdateSkill,
  type FormulateModelInfo,
  type Skill,
  type CuratedSkill,
} from '../api/skills.ts'
import FormulatePanel from '../components/formulate/FormulatePanel.tsx'
import PageHeader from '../components/layout/PageHeader.tsx'

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
      <PageHeader
        eyebrow={project?.name}
        title="Skills"
        description="Prompt-augmentation snippets agents can be assigned to specialise their behaviour."
        actions={
          <>
            <Button appearance="secondary" onClick={() => setShowCurated(true)}>Browse curated</Button>
            <Button appearance="primary" onClick={() => setShowCreate(true)}>New skill</Button>
          </>
        }
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', maxWidth: '1100px', width: '100%', margin: '0 auto' }}>
        {isLoading && <Body1 style={{ color: tokens.colorNeutralForeground3 }}>Loading…</Body1>}
        {!isLoading && skills.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
            <Body1 style={{ display: 'block', marginBottom: tokens.spacingVerticalM }}>No skills yet.</Body1>
            <Button appearance="secondary" onClick={() => setShowCurated(true)}>Browse the curated library</Button>
          </div>
        )}
        {Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
          <section key={cat} style={{ marginBottom: '24px' }}>
            <Caption1 style={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalS, fontWeight: tokens.fontWeightSemibold }}>
              {cat}
            </Caption1>
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
          <Body1Strong style={{ color: tokens.colorNeutralForeground1 }}>{skill.name}</Body1Strong>
          <code style={{ fontSize: '11px', color: tokens.colorNeutralForeground3, fontFamily: tokens.fontFamilyMonospace }}>{skill.key}</code>
          {skill.curatedKey && (
            <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '8px', background: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1 }}>curated</span>
          )}
        </div>
        {skill.description && (
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, margin: '0 0 6px' }}>{skill.description}</Caption1>
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
  const [modelUsed, setModelUsed] = useState<FormulateModelInfo | null>(null)
  const create = useCreateSkill(projectId)
  const update = useUpdateSkill(projectId)
  const formulate = useFormulateSkill(projectId)

  function handleFormulate(draft: string) {
    formulate.mutate(draft, {
      onSuccess: ({ skill: drafted, modelUsed: info }) => {
        setForm({
          key: drafted.key,
          name: drafted.name,
          description: drafted.description,
          category: drafted.category,
          promptAddendum: drafted.promptAddendum,
        })
        setKeyError('')
        setModelUsed(info)
      },
    })
  }

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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingTop: '8px' }}>
              {!skill && (
                <FormulatePanel
                  placeholder="e.g. a checklist skill that reminds the agent to verify tests, lint, and changelog before submitting code review"
                  hint="Sketch a skill in plain language; AI fills the form for you to review."
                  isPending={formulate.isPending}
                  errorMessage={formulate.error?.message ?? null}
                  modelUsed={modelUsed}
                  onFormulate={handleFormulate}
                />
              )}
              <form id="skill-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
            </div>
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
