/**
 * Skills page — Phase 13 project-scoped skills registry.
 *
 * Lists every skill in the project, grouped by category. Each row supports
 * inline edit + delete. A "Browse curated" modal exposes the bundled
 * library so users can clone starter skills into the project. A "New skill"
 * modal supports authoring a custom skill from scratch.
 *
 * Skills surface markdown content to assigned agents — the editor shows the
 * stored content that will be injected into the agent's system prompt.
 */

import { useRef, useState } from 'react'
import { useParams } from 'react-router'
import {
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
import { Add20Regular, ArrowUpload20Regular, BookStarRegular, Library20Regular } from '@fluentui/react-icons'
import { useProject } from '../api/projects.ts'
import {
  useCloneCuratedSkill,
  useCreateSkill,
  useCuratedSkills,
  useDeleteSkill,
  useFormulateSkill,
  useImportSkillFromMd,
  useSkills,
  useUpdateSkill,
  type FormulateModelInfo,
  type Skill,
  type CuratedSkill,
} from '../api/skills.ts'
import FormulatePanel from '../components/formulate/FormulatePanel.tsx'
import PageHeader from '../components/layout/PageHeader.tsx'
import EmptyState from '../components/layout/EmptyState.tsx'
import { PageLoading } from '../components/loading/index.tsx'
import { formatCuratedSkillLabel, getSkillProvenanceMeta } from '../utils/skill-provenance.ts'

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
  const importMd = useImportSkillFromMd(projectId)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [importMessage, setImportMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

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

  async function handleImportFile(file: File) {
    setImportMessage(null)
    try {
      const text = await file.text()
      const created = await importMd.mutateAsync({ content: text, filename: file.name })
      setImportMessage({ kind: 'ok', text: `Imported "${created.name}" (key: ${created.key}).` })
    } catch (err) {
      setImportMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Import failed' })
    }
  }

  if (isLoading) {
    return (
      <PageLoading
        header={
          <PageHeader
            eyebrow={project?.name}
            title="Skills"
            description="Prompt-augmentation snippets agents can be assigned to specialise their behaviour."
          />
        }
        label="Loading skills…"
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader
        eyebrow={project?.name}
        title="Skills"
        description="Prompt-augmentation snippets agents can be assigned to specialise their behaviour."
        actions={
          <>
            <input
              ref={importInputRef}
              type="file"
              accept=".md,text/markdown"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleImportFile(f)
                e.target.value = ''
              }}
            />
            <Button
              appearance="secondary"
              icon={<ArrowUpload20Regular />}
              onClick={() => importInputRef.current?.click()}
              disabled={importMd.isPending}
            >
              {importMd.isPending ? 'Importing…' : 'Import .md'}
            </Button>
            <Button appearance="secondary" icon={<Library20Regular />} onClick={() => setShowCurated(true)}>Browse curated</Button>
            <Button appearance="primary" icon={<Add20Regular />} onClick={() => setShowCreate(true)}>New skill</Button>
          </>
        }
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', maxWidth: '1100px', width: '100%', margin: '0 auto' }}>
        {importMessage && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              marginBottom: '12px',
              fontSize: '13px',
              background: importMessage.kind === 'ok' ? tokens.colorPaletteGreenBackground2 : tokens.colorPaletteRedBackground2,
              color: importMessage.kind === 'ok' ? tokens.colorPaletteGreenForeground2 : tokens.colorPaletteRedForeground2,
              border: `1px solid ${importMessage.kind === 'ok' ? tokens.colorPaletteGreenBorderActive : tokens.colorPaletteRedBorderActive}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>{importMessage.text}</span>
            <Button size="small" appearance="subtle" onClick={() => setImportMessage(null)}>Dismiss</Button>
          </div>
        )}
        {!isLoading && skills.length === 0 && (
          /* Wave 10 C5: Ceremonies-style empty state with the full Skills triplet
             (Browse curated + New + Import). Stream D's Import.md and curated
             provenance remain intact. */
          <EmptyState
            icon={<BookStarRegular />}
            title="No skills yet"
            description="Skills inject prompt fragments into agents to specialise their behaviour. Browse the curated library, author one from scratch, or import a SKILL.md from another project."
            actions={
              <>
                <Button
                  appearance="secondary"
                  icon={<ArrowUpload20Regular />}
                  onClick={() => importInputRef.current?.click()}
                  disabled={importMd.isPending}
                >
                  {importMd.isPending ? 'Importing…' : 'Import .md'}
                </Button>
                <Button appearance="secondary" icon={<Library20Regular />} onClick={() => setShowCurated(true)}>
                  Browse curated
                </Button>
                <Button appearance="primary" icon={<Add20Regular />} onClick={() => setShowCreate(true)}>
                  New skill
                </Button>
              </>
            }
          />
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

function SourceBadge({
  source,
  curatedKey,
  sourceUri,
}: {
  source: Skill['source']
  curatedKey?: string | null
  sourceUri?: string | null
}) {
  const provenance = getSkillProvenanceMeta(source, curatedKey, sourceUri)
  const colors = (() => {
    switch (source) {
      case 'curated':
        return { bg: tokens.colorBrandBackground2, fg: tokens.colorBrandForeground1 }
      case 'imported':
        return { bg: tokens.colorPaletteGreenBackground2, fg: tokens.colorPaletteGreenForeground2 }
      case 'project':
        return { bg: tokens.colorNeutralBackground3, fg: tokens.colorNeutralForeground2 }
      case 'custom':
      default:
        return { bg: tokens.colorNeutralBackground3, fg: tokens.colorNeutralForeground2 }
    }
  })()
  return (
    <span
      style={{
        fontSize: '10px',
        padding: '1px 6px',
        borderRadius: '8px',
        background: colors.bg,
        color: colors.fg,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontWeight: 600,
      }}
      title={provenance.title}
    >
      {provenance.label}
    </span>
  )
}

function getSkillContentSummary(skill: Pick<Skill, 'source' | 'sourceUri'>) {
  if (skill.source === 'imported' && skill.sourceUri?.endsWith('/SKILL.md')) {
    return 'View imported SKILL.md content'
  }
  if (skill.source === 'imported') {
    return 'View imported skill content'
  }
  if (skill.source === 'curated') {
    return 'View curated skill content'
  }
  return 'View skill content'
}

function SkillRow({ skill, onEdit, onDelete }: { skill: Skill; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: '6px', padding: '12px 16px',
      background: 'var(--surface)', display: 'flex', gap: '16px', alignItems: 'flex-start',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
          <Body1Strong style={{ color: tokens.colorNeutralForeground1 }}>{skill.name}</Body1Strong>
          <code style={{ fontSize: '11px', color: tokens.colorNeutralForeground3, fontFamily: tokens.fontFamilyMonospace }}>{skill.key}</code>
          <SourceBadge source={skill.source} curatedKey={skill.curatedKey} sourceUri={skill.sourceUri} />
          {skill.curatedKey && skill.source !== 'curated' && (
            <span
              title={`Original curated skill key: ${skill.curatedKey}`}
              style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '8px', background: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1 }}
            >
              {formatCuratedSkillLabel(skill.curatedKey)}
            </span>
          )}
        </div>
        {skill.description && (
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, margin: '0 0 6px' }}>{skill.description}</Caption1>
        )}
        {skill.sourceUri && (
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, margin: '0 0 6px', fontFamily: tokens.fontFamilyMonospace, fontSize: '11px' }}>
            Source file: {skill.sourceUri}
          </Caption1>
        )}
        <details style={{ fontSize: '12px' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>{getSkillContentSummary(skill)}</summary>
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
                <Field label="Skill content" hint="Markdown injected into the agent's system prompt when this skill is assigned.">
                  <Textarea
                    value={form.promptAddendum}
                    onChange={(_, d) => setForm({ ...form, promptAddendum: d.value })}
                    rows={8}
                    placeholder="Describe when to use this skill, the process to follow, and the expected output."
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
                        <span
                          title="Bundled curated starter available to clone into this project."
                          style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '8px', background: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}
                        >
                          Curated starter
                        </span>
                        <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '8px', background: 'var(--bg)', color: 'var(--text-muted)' }}>{c.category}</span>
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0' }}>{c.description}</p>
                      <details style={{ fontSize: '12px', marginTop: '8px' }}>
                        <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>Preview skill content</summary>
                        <pre style={{
                          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '4px',
                          padding: '8px', marginTop: '6px', fontSize: '11px', color: 'var(--text)',
                          whiteSpace: 'pre-wrap', maxHeight: '180px', overflow: 'auto',
                        }}>{c.promptAddendum}</pre>
                      </details>
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
