import {
  describePolicy,
  type ResolvedReviewPolicy,
  type PolicySources,
} from '../../api/review-policies.ts'
import { PolicyExplainer } from './PolicyExplainer.tsx'
import { Shield20Regular } from '@fluentui/react-icons'

export interface ReviewPolicyHeaderProps {
  policy: ResolvedReviewPolicy
  sources?: PolicySources
  warnings?: string[]
  compact?: boolean
}

export function ReviewPolicyHeader({ policy, sources, warnings, compact }: ReviewPolicyHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap',
        padding: compact ? '6px 10px' : '8px 12px',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        fontSize: '12px',
        color: 'var(--text)',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
        <Shield20Regular style={{ width: 16, height: 16 }} />
        Policy
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{describePolicy(policy)}</span>
      {sources && <PolicyExplainer policy={policy} sources={sources} warnings={warnings} />}
    </div>
  )
}
