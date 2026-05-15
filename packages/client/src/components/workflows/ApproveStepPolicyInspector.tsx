import { useMemo } from 'react'
import {
  useReviewPolicyPresets,
  useReviewPolicyDefault,
  describePolicy,
  type ReviewPolicyPayload,
  type ReviewPolicyPreset,
} from '../../api/review-policies.ts'
import { ReviewPolicyHeader } from '../reviews/ReviewPolicyHeader.tsx'

// ---------------------------------------------------------------------------
// Hand-rolled approve-step extractor over the workflow YAML string.
// We avoid pulling js-yaml into the client bundle because:
//   1. The approve-step subset we need is flat (one nested object: quorum).
//   2. We must round-trip changes back to the same YAML the user is editing,
//      preserving comments / whitespace; a round-tripping yaml lib would
//      blow that away on serialise.
// ---------------------------------------------------------------------------

export interface ApproveStepBlock {
  /** Zero-based index into the parent workflow's `steps:` list (counts ALL steps). */
  stepIndex: number
  /** Source line where `- type: approve` appears (1-based). */
  startLine: number
  /** Source line where the step block ends (last line of this step, 1-based). */
  endLine: number
  /** Indent width (spaces) of the `- type:` marker. */
  indent: number
  label: string | null
  payload: ReviewPolicyPayload
}

const FIELD_PATTERNS: Array<[keyof ReviewPolicyPayload, RegExp]> = [
  ['request_changes_policy', /^request_changes_policy\s*:\s*['"]?([a-z_]+)['"]?\s*$/i],
  ['timeout', /^timeout\s*:\s*['"]?([^'"\s]+)['"]?\s*$/i],
  ['timeout_action', /^timeout_action\s*:\s*['"]?([a-z_]+)['"]?\s*$/i],
  ['fallback_reviewer', /^fallback_reviewer\s*:\s*['"]?([^'"]+?)['"]?\s*$/i],
  ['exclude_author', /^exclude_author\s*:\s*(true|false)\s*$/i],
]

function parseApproveStepBlock(lines: string[], start: number): ApproveStepBlock {
  const headerLine = lines[start]
  const indentMatch = headerLine.match(/^(\s*)-/)
  const indent = indentMatch ? indentMatch[1].length : 0
  const childIndent = indent + 2

  let endLine = start
  let label: string | null = null
  const payload: ReviewPolicyPayload = {}

  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i]
    if (raw.trim() === '' || raw.trim().startsWith('#')) {
      endLine = i
      continue
    }
    const leading = raw.length - raw.trimStart().length
    if (leading <= indent) break

    const stripped = raw.slice(childIndent)
    if (raw.length - raw.trimStart().length < childIndent) {
      // Line is part of a deeper nested block (e.g. quorum.n).
      endLine = i
      continue
    }

    const labelMatch = stripped.match(/^label\s*:\s*['"]?(.+?)['"]?\s*$/)
    if (labelMatch) {
      label = labelMatch[1]
      endLine = i
      continue
    }

    if (/^approvers\s*:\s*\[(.*)\]\s*$/.test(stripped)) {
      const m = stripped.match(/^approvers\s*:\s*\[(.*)\]\s*$/)!
      payload.approvers = m[1]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
      endLine = i
      continue
    }

    if (/^quorum\s*:\s*$/.test(stripped)) {
      const q: { n?: number; of?: number } = {}
      let j = i + 1
      while (j < lines.length) {
        const sub = lines[j]
        const subLeading = sub.length - sub.trimStart().length
        if (subLeading <= childIndent) break
        const nMatch = sub.trim().match(/^n\s*:\s*(\d+)\s*$/)
        const ofMatch = sub.trim().match(/^of\s*:\s*(\d+)\s*$/)
        if (nMatch) q.n = parseInt(nMatch[1], 10)
        if (ofMatch) q.of = parseInt(ofMatch[1], 10)
        j++
      }
      if (q.n != null && q.of != null) payload.quorum = { n: q.n, of: q.of }
      endLine = j - 1
      i = j - 1
      continue
    }

    if (/^quorum\s*:\s*\{[^}]*\}\s*$/.test(stripped)) {
      const m = stripped.match(/n\s*:\s*(\d+)/)
      const o = stripped.match(/of\s*:\s*(\d+)/)
      if (m && o) payload.quorum = { n: parseInt(m[1], 10), of: parseInt(o[1], 10) }
      endLine = i
      continue
    }

    let matched = false
    for (const [key, re] of FIELD_PATTERNS) {
      const m = stripped.match(re)
      if (m) {
        if (key === 'exclude_author') {
          payload.exclude_author = m[1].toLowerCase() === 'true'
        } else {
          ;(payload as Record<string, unknown>)[key] = m[1]
        }
        matched = true
        break
      }
    }
    if (matched) {
      endLine = i
      continue
    }

    // Unknown field on this step — keep it inside the block but don't
    // try to parse it.
    endLine = i
  }

  return { stepIndex: -1, startLine: start, endLine, indent, label, payload }
}

export function parseApproveSteps(yaml: string): ApproveStepBlock[] {
  const lines = yaml.split('\n')
  const blocks: ApproveStepBlock[] = []
  let stepIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)-\s+type\s*:\s*([a-z_]+)/)
    if (!m) continue
    stepIndex++
    if (m[2] !== 'approve') continue
    const block = parseApproveStepBlock(lines, i)
    block.stepIndex = stepIndex
    blocks.push(block)
  }
  return blocks
}

// ---------------------------------------------------------------------------
// YAML splicer — replaces an approve step's body with the chosen payload.
// Preserves the `- type: approve` header line + label (if present).
// ---------------------------------------------------------------------------

function serialisePayload(payload: ReviewPolicyPayload, baseIndent: number): string[] {
  const pad = ' '.repeat(baseIndent)
  const out: string[] = []
  if (payload.approvers && payload.approvers.length > 0) {
    out.push(`${pad}approvers: [${payload.approvers.map((a) => JSON.stringify(a)).join(', ')}]`)
  }
  if (payload.request_changes_policy) {
    out.push(`${pad}request_changes_policy: ${payload.request_changes_policy}`)
  }
  if (payload.quorum) {
    out.push(`${pad}quorum:`)
    out.push(`${pad}  n: ${payload.quorum.n}`)
    out.push(`${pad}  of: ${payload.quorum.of}`)
  }
  if (payload.exclude_author) out.push(`${pad}exclude_author: true`)
  if (payload.timeout) out.push(`${pad}timeout: ${payload.timeout}`)
  if (payload.timeout_action) out.push(`${pad}timeout_action: ${payload.timeout_action}`)
  if (payload.fallback_reviewer) {
    out.push(`${pad}fallback_reviewer: ${JSON.stringify(payload.fallback_reviewer)}`)
  }
  return out
}

export function applyPresetToYaml(
  yaml: string,
  block: ApproveStepBlock,
  payload: ReviewPolicyPayload,
): string {
  const lines = yaml.split('\n')
  const childIndent = block.indent + 2
  const pad = ' '.repeat(childIndent)

  // Keep the `- type: approve` header + the label (if any) untouched. Replace
  // every other line in the block with the serialised payload.
  const keep: string[] = [lines[block.startLine]]
  for (let i = block.startLine + 1; i <= block.endLine; i++) {
    const stripped = lines[i].slice(childIndent)
    if (/^label\s*:/.test(stripped)) keep.push(lines[i])
  }
  if (keep.length === 1 && block.label) {
    keep.push(`${pad}label: ${JSON.stringify(block.label)}`)
  }
  const replacement = serialisePayload(payload, childIndent)
  return [
    ...lines.slice(0, block.startLine),
    ...keep,
    ...replacement,
    ...lines.slice(block.endLine + 1),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Inspector component
// ---------------------------------------------------------------------------

export interface ApproveStepPolicyInspectorProps {
  projectId: string
  yaml: string
  onChangeYaml: (next: string) => void
}

export function ApproveStepPolicyInspector({
  projectId,
  yaml,
  onChangeYaml,
}: ApproveStepPolicyInspectorProps) {
  const blocks = useMemo(() => parseApproveSteps(yaml), [yaml])
  const { data: presets } = useReviewPolicyPresets(projectId)
  const { data: defaultResp } = useReviewPolicyDefault(projectId)

  if (blocks.length === 0) {
    return (
      <div style={{ padding: '12px 14px', fontSize: '12px', color: 'var(--text-muted)' }}>
        This workflow has no <code style={{ color: 'var(--text)' }}>approve</code> steps. Add one to
        configure review policies.
      </div>
    )
  }

  const handleApply = (block: ApproveStepBlock, preset: ReviewPolicyPreset) => {
    onChangeYaml(applyPresetToYaml(yaml, block, preset.payload))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px 14px' }}>
      {blocks.map((block) => {
        // Resolve "what will actually run" by layering this step's payload on
        // the project default, mirroring the server resolver.
        const projectPayload = defaultResp?.stored ?? undefined
        const merged: ReviewPolicyPayload = {
          ...(projectPayload ?? {}),
          ...block.payload,
        }
        if (block.payload.quorum || projectPayload?.quorum) {
          merged.quorum = block.payload.quorum ?? projectPayload?.quorum
        }
        const resolved = {
          approvers: merged.approvers ?? [],
          approver_objects: merged.approver_objects ?? [],
          request_changes_policy: merged.request_changes_policy ?? 'first',
          quorum: merged.quorum ?? null,
          exclude_author: merged.exclude_author ?? false,
          timeout: merged.timeout ?? '24h',
          timeout_action: merged.timeout_action ?? 'notify',
          fallback_reviewer: merged.fallback_reviewer ?? null,
        } as const
        return (
          <div
            key={block.stepIndex}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Step {block.stepIndex + 1}</span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>
                {block.label ?? 'approve'}
              </span>
              {Object.keys(block.payload).length === 0 && (
                <span style={{ fontSize: '10px', color: '#d29922' }}>
                  using project default
                </span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text)' }}>{describePolicy(resolved)}</div>
            {presets && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Apply preset:</span>
                {[...presets.system, ...presets.project].map((p) => (
                  <button
                    key={`${p.scope}:${p.slug}`}
                    onClick={() => handleApply(block, p)}
                    title={p.description ?? p.name}
                    style={{
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      borderRadius: '999px',
                      padding: '2px 10px',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
        Resolved policies blend the step's YAML with the project default. Apply a preset to overwrite
        the step's policy fields in the YAML — your other step content (label, comments) is preserved.
      </p>
    </div>
  )
}

// Re-export for the header pill.
export { ReviewPolicyHeader }
