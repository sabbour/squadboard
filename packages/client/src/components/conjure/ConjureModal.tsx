/**
 * ConjureModal — universal intent-routing creation surface (Wave 22).
 *
 * Opens as a Fluent 2 Dialog. User types prose → client heuristic pre-classifier
 * fires first (no network for obvious cases); otherwise POSTs to
 * /api/conjure/classify. Top-3 candidates appear as selectable chips.
 *
 * Routing strategy (Option C — Hybrid, per McManus design proposal):
 *   Light artifacts  (issue, inbox-item, consult): in-place create.
 *   Heavy artifacts  (project, team, agent, skill, tool, ceremony, mcp-server):
 *                   stash draft in sessionStorage → navigate-with-draft + 3s undo toast.
 *
 * Spec reference: .squad/decisions-archive.md lines 1666–1960.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Button,
  Textarea,
  Spinner,
  MessageBar,
  MessageBarBody,
  tokens,
  makeStyles,
} from '@fluentui/react-components'
import { Wand20Regular, Dismiss20Regular } from '@fluentui/react-icons'
import { apiFetch } from '../../api/client.ts'
import { useCreateIssue } from '../../api/issues.ts'
import { useCreateInboxItem } from '../../api/inbox.ts'
import { createPortal } from 'react-dom'
import type { ConjureHint } from '../../context/ConjureContext.tsx'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// All intents the client can handle (superset of current server 6-kind list;
// ready for Verbal-w22's extension to 10 kinds).
export type ConjureIntent =
  | 'project'
  | 'issue'
  | 'team'
  | 'agent'
  | 'skill'
  | 'tool'
  | 'inbox-item'
  | 'consult'
  | 'ceremony'
  | 'mcp-server'

export const LABEL_FOR: Record<ConjureIntent, string> = {
  issue: 'Issue',
  'inbox-item': 'Inbox item',
  consult: 'Consult session',
  ceremony: 'Ceremony',
  project: 'Project',
  team: 'Team',
  agent: 'Agent',
  skill: 'Skill',
  tool: 'Tool',
  'mcp-server': 'MCP server',
}

// Intents handled in-place (light). Everything else navigates-with-draft.
const LIGHT_INTENTS = new Set<ConjureIntent>(['issue', 'inbox-item', 'consult'])

interface ClassifyCandidate {
  intent: ConjureIntent
  confidence: number | null
}

// Server response shape (current server returns single-winner + routing.fallbacks;
// Verbal-w22 will extend this to full candidates array — we handle both).
interface ServerClassifyResponse {
  ok: boolean
  data?: {
    intent: string
    confidence: number
    draft: Record<string, unknown>
    routing?: {
      destination: string
      presentation: 'modal' | 'page'
      fallbacks?: string[]
    }
    // Verbal-w22 extension (may or may not be present):
    candidates?: Array<{ intent: string; confidence: number; reason?: string; draft?: object }>
    rationale?: string
    strategy?: string
  }
  error?: string
}

// ---------------------------------------------------------------------------
// Heuristic fast-path (client-side, no network)
// ---------------------------------------------------------------------------

function heuristicClassify(prose: string): { intent: ConjureIntent; confidence: number } | null {
  const lower = prose.toLowerCase().trimStart()
  if (/^(bug:|fix:|task:)/i.test(prose)) return { intent: 'issue', confidence: 0.95 }
  if (/^(hire |recruit )/i.test(lower)) {
    const intent: ConjureIntent = /\bteam\b/.test(lower) ? 'team' : 'agent'
    return { intent, confidence: 0.92 }
  }
  if (/^(project:|new project)/i.test(lower)) return { intent: 'project', confidence: 0.95 }
  return null
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = makeStyles({
  surface: {
    maxWidth: '560px',
    width: '100%',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    paddingTop: tokens.spacingVerticalS,
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalS,
  },
  heuristic: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    marginTop: tokens.spacingVerticalXS,
  },
})

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ConjureModalProps {
  isOpen: boolean
  onClose: () => void
  hint?: ConjureHint
  initialProse?: string
  projectId?: string | null
  projectName?: string | null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConjureModal({
  isOpen,
  onClose,
  hint,
  initialProse = '',
  projectId,
  projectName,
}: ConjureModalProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const styles = useStyles()

  const [prose, setProse] = useState(initialProse)
  const [classifying, setClassifying] = useState(false)
  const [candidates, setCandidates] = useState<ClassifyCandidate[]>([])
  const [selectedIntent, setSelectedIntent] = useState<ConjureIntent | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [heuristicUsed, setHeuristicUsed] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftKeyRef = useRef<string | null>(null)
  const pendingNavRef = useRef<string | null>(null)

  const createIssue = useCreateIssue(projectId ?? '')
  const createInboxItem = useCreateInboxItem()

  // Reset state when modal opens/closes or initialProse changes.
  useEffect(() => {
    if (isOpen) {
      setProse(initialProse)
      setCandidates([])
      setSelectedIntent(null)
      setDraft(null)
      setError(null)
      setSubmitting(false)
      setHeuristicUsed(false)
      draftKeyRef.current = null
      pendingNavRef.current = null
    }
  }, [isOpen, initialProse])

  // Auto-apply heuristic when modal opens with a hint (e.g. Board FAB with hint="issue").
  useEffect(() => {
    if (!isOpen || !hint) return
    const heuristicIntent = hint as ConjureIntent
    if (LABEL_FOR[heuristicIntent]) {
      setCandidates([{ intent: heuristicIntent, confidence: null }])
      setSelectedIntent(heuristicIntent)
      setHeuristicUsed(true)
    }
  }, [isOpen, hint])

  // Show classification results from heuristic fast-path.
  function applyHeuristic(prose: string): boolean {
    const match = heuristicClassify(prose)
    if (!match || match.confidence < 0.9) return false
    setCandidates([{ intent: match.intent, confidence: match.confidence }])
    setSelectedIntent(match.intent)
    setHeuristicUsed(true)
    return true
  }

  // POST to /api/conjure/classify.
  async function classify(prose: string) {
    setClassifying(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { prompt: prose }
      if (hint) body.hint = hint
      if (projectId || projectName) {
        body.context = {
          currentProjectId: projectId ?? null,
          currentProjectName: projectName ?? null,
        }
      }
      const res = await apiFetch<ServerClassifyResponse>('/api/conjure/classify', {
        method: 'POST',
        body: JSON.stringify(body),
      })

      if (!res.ok || !res.data) {
        throw new Error(res.error ?? 'Classification failed')
      }

      const d = res.data

      // Prefer Verbal-w22's candidates array if present; fall back to
      // winner + routing.fallbacks as a top-3 approximation.
      let builtCandidates: ClassifyCandidate[]
      if (d.candidates && d.candidates.length > 0) {
        builtCandidates = d.candidates.slice(0, 3).map((c) => ({
          intent: c.intent as ConjureIntent,
          confidence: c.confidence,
        }))
      } else {
        builtCandidates = [{ intent: d.intent as ConjureIntent, confidence: d.confidence }]
        for (const f of d.routing?.fallbacks ?? []) {
          builtCandidates.push({ intent: f as ConjureIntent, confidence: null })
        }
        builtCandidates = builtCandidates.slice(0, 3)
      }

      setCandidates(builtCandidates)
      const winner = builtCandidates[0]
      setSelectedIntent(winner?.intent ?? null)
      setDraft(d.draft ?? null)
      setHeuristicUsed(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Classification failed')
    } finally {
      setClassifying(false)
    }
  }

  // ── Submit handler ───────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!prose.trim()) return

    // Phase 1: If no classification yet, try heuristic then server.
    if (candidates.length === 0) {
      if (!applyHeuristic(prose)) {
        await classify(prose)
      }
      return // Wait for the user to confirm (or auto-confirm on next click).
    }

    // Phase 2: Classification done, selectedIntent known — create the artifact.
    if (!selectedIntent) return

    setSubmitting(true)
    setError(null)
    try {
      if (LIGHT_INTENTS.has(selectedIntent)) {
        await handleLightCreate(selectedIntent)
      } else {
        handleHeavyNavigate(selectedIntent)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creation failed')
      setSubmitting(false)
    }
  }

  // ── In-place create (light artifacts) ────────────────────────────────────

  async function handleLightCreate(intent: ConjureIntent) {
    if (intent === 'issue') {
      if (!projectId) {
        // No project context — fall back to inbox-item.
        await createInboxItemFromProse()
        return
      }
      const issueDraft = draft as { title?: string; body?: string; columnSlug?: string } | null
      const title = (issueDraft?.title as string | undefined) || prose.slice(0, 120)
      const body = (issueDraft?.body as string | undefined) || prose
      await createIssue.mutateAsync({ title, body })
      await queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
      showToast(`✓ Issue created`)
      onClose()
    } else if (intent === 'inbox-item') {
      await createInboxItemFromProse()
    } else if (intent === 'consult') {
      // Consult is "light" — just navigate to consult/new with prose pre-filled.
      const encoded = encodeURIComponent(prose)
      onClose()
      void navigate(
        projectId
          ? `/projects/${projectId}/consult/new?prefill=text:${encoded}`
          : `/consult/new?prefill=text:${encoded}`,
      )
    }
  }

  async function createInboxItemFromProse() {
    await createInboxItem.mutateAsync({
      originalDraft: prose,
      suggestedProjectId: projectId ?? null,
    })
    await queryClient.invalidateQueries({ queryKey: ['inbox'] })
    showToast(`✓ Inbox item captured`)
    onClose()
  }

  // ── Navigate-with-draft (heavy artifacts) ────────────────────────────────

  function handleHeavyNavigate(intent: ConjureIntent) {
    const draftKey = `conjure-draft-${crypto.randomUUID()}`
    sessionStorage.setItem(draftKey, JSON.stringify({ intent, draft: draft ?? {}, prose }))
    draftKeyRef.current = draftKey

    const dest = buildHeavyDest(intent, draftKey)
    pendingNavRef.current = dest

    const label = LABEL_FOR[intent]
    showToast(`Navigating to ${label} creator…`, 3000, () => {
      // Undo: clear sessionStorage and don't navigate.
      if (draftKeyRef.current) {
        sessionStorage.removeItem(draftKeyRef.current)
        draftKeyRef.current = null
        pendingNavRef.current = null
      }
    })

    // Navigate after a 150ms yield so the toast renders first.
    setTimeout(() => {
      if (pendingNavRef.current) {
        onClose()
        void navigate(pendingNavRef.current)
      }
      setSubmitting(false)
    }, 150)
  }

  function buildHeavyDest(intent: ConjureIntent, draftKey: string): string {
    const pid = projectId ?? ''
    const q = `?draft=${encodeURIComponent(draftKey)}`
    switch (intent) {
      case 'project':   return `/projects/new${q}`
      case 'team':      return pid ? `/projects/${pid}/agents${q}&conjure=team` : `/projects/new${q}`
      case 'agent':     return pid ? `/projects/${pid}/agents${q}&conjure=agent` : `/projects/new${q}`
      case 'skill':     return pid ? `/projects/${pid}/skills${q}` : `/${q}`
      case 'tool':      return pid ? `/projects/${pid}/tools${q}` : `/${q}`
      case 'ceremony':  return pid ? `/projects/${pid}/ceremonies${q}` : `/${q}`
      case 'mcp-server':return pid ? `/projects/${pid}/mcp-servers${q}` : `/${q}`
      default:          return '/'
    }
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  function showToast(msg: string, durationMs = 3000, onUndo?: () => void) {
    setToastMsg(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => {
      setToastMsg(null)
    }, durationMs)
    // Store undo callback on the timer so the undo button can call it.
    ;(toastTimerRef.current as unknown as { onUndo?: () => void }).onUndo = onUndo
  }

  function handleUndo() {
    if (toastTimerRef.current) {
      const cb = (toastTimerRef.current as unknown as { onUndo?: () => void }).onUndo
      if (cb) cb()
      clearTimeout(toastTimerRef.current)
    }
    setToastMsg(null)
    setSubmitting(false)
    pendingNavRef.current = null
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const trimmedProse = prose.trim()
  const hasClassification = candidates.length > 0
  const canSubmit = trimmedProse.length > 0 && !classifying && !submitting

  const primaryLabel = selectedIntent
    ? `Create ${LABEL_FOR[selectedIntent]}`
    : hasClassification
    ? 'Confirm'
    : 'Classify'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(_, data) => { if (!data.open) onClose() }}>
        <DialogSurface className={styles.surface}>
          <DialogBody>
            <DialogTitle
              action={
                <Button
                  appearance="subtle"
                  aria-label="Close"
                  icon={<Dismiss20Regular />}
                  onClick={onClose}
                />
              }
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS }}>
                <Wand20Regular />
                Conjure
              </span>
            </DialogTitle>

            <DialogContent className={styles.body}>
              <Textarea
                placeholder="What do you want to create? (e.g. 'fix the login button on Safari', 'hire a QA agent', 'add a daily standup ceremony')"
                autoFocus
                value={prose}
                onChange={(_, data) => {
                  setProse(data.value)
                  // Reset classification when user edits prose.
                  if (hasClassification) {
                    setCandidates([])
                    setSelectedIntent(null)
                    setDraft(null)
                    setHeuristicUsed(false)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void handleSubmit()
                  }
                }}
                rows={4}
                resize="vertical"
                style={{ width: '100%' }}
              />

              {heuristicUsed && candidates.length > 0 && (
                <p className={styles.heuristic}>
                  ⚡ Detected instantly — no server round-trip needed.
                </p>
              )}

              {/* Candidate chips */}
              {candidates.length > 0 && (
                <div role="radiogroup" aria-label="Detected intents" className={styles.chipRow}>
                  {candidates.map((c) => (
                    <CandidateChip
                      key={c.intent}
                      intent={c.intent}
                      confidence={c.confidence}
                      selected={selectedIntent === c.intent}
                      onSelect={() => setSelectedIntent(c.intent)}
                    />
                  ))}
                </div>
              )}

              {classifying && (
                <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS }}>
                  <Spinner size="tiny" />
                  <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
                    Classifying…
                  </span>
                </div>
              )}

              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}

              {!hasClassification && !classifying && trimmedProse && (
                <p style={{ fontSize: '11px', color: tokens.colorNeutralForeground3, margin: 0 }}>
                  Press <kbd style={kbdStyle}>Ctrl+Enter</kbd> or click <strong>Classify</strong> to detect intent.
                </p>
              )}
            </DialogContent>

            <DialogActions>
              <Button appearance="secondary" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                icon={submitting ? <Spinner size="tiny" /> : undefined}
              >
                {submitting ? 'Creating…' : primaryLabel}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Success / navigation toast */}
      {toastMsg && createPortal(
        <ConjureToast
          message={toastMsg}
          onUndo={handleUndo}
          onDismiss={() => setToastMsg(null)}
        />,
        document.body,
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// CandidateChip
// ---------------------------------------------------------------------------

function CandidateChip({
  intent,
  confidence,
  selected,
  onSelect,
}: {
  intent: ConjureIntent
  confidence: number | null
  selected: boolean
  onSelect: () => void
}) {
  const label = LABEL_FOR[intent] ?? intent
  const pct = confidence !== null ? ` · ${Math.round(confidence * 100)}%` : ''
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      style={{
        fontSize: '12px',
        padding: '5px 12px',
        borderRadius: '16px',
        border: `1.5px solid ${selected ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke2}`,
        background: selected ? tokens.colorBrandBackground2 : 'transparent',
        color: selected ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground1,
        cursor: 'pointer',
        transition: 'all 0.1s ease',
        fontWeight: selected ? tokens.fontWeightSemibold : tokens.fontWeightRegular,
      }}
    >
      {label}{pct}
    </button>
  )
}

// ---------------------------------------------------------------------------
// ConjureToast — success / navigate-with-draft notification
// ---------------------------------------------------------------------------

function ConjureToast({
  message,
  onUndo,
  onDismiss,
}: {
  message: string
  onUndo?: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: '88px', // above FAB
        right: '24px',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        background: tokens.colorNeutralBackground2,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderLeft: `4px solid ${tokens.colorBrandBackground}`,
        borderRadius: '8px',
        padding: '10px 14px',
        maxWidth: '340px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        animation: 'sq-conjure-toast-in 0.2s ease-out',
      }}
    >
      <span style={{ flex: 1, fontSize: '13px', color: tokens.colorNeutralForeground1 }}>
        {message}
      </span>
      {onUndo && (
        <button
          type="button"
          onClick={onUndo}
          style={{
            background: 'none',
            border: 'none',
            color: tokens.colorBrandForeground1,
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            padding: '0 4px',
          }}
        >
          Undo
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: tokens.colorNeutralForeground3,
          fontSize: '16px',
          cursor: 'pointer',
          lineHeight: 1,
          padding: '0 2px',
        }}
      >
        ×
      </button>
      <style>{`
        @keyframes sq-conjure-toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared kbd style
// ---------------------------------------------------------------------------

const kbdStyle: React.CSSProperties = {
  fontSize: '10px',
  padding: '1px 5px',
  borderRadius: '3px',
  border: `1px solid ${tokens.colorNeutralStroke2}`,
  background: tokens.colorNeutralBackground3,
  fontFamily: tokens.fontFamilyMonospace,
}
