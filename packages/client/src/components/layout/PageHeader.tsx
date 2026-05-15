/**
 * PageHeader — shared landing-page header used across every in-project page.
 *
 * Replaces the divergent header markup that was duplicated across
 * Ceremonies, Skills, Tools, MCP Servers, Costs, Agents, Dashboard,
 * Project Flow, Inbox, Settings, etc. — each of which had its own
 * font-size, spacing, and project-name format.
 *
 * Pattern:
 *   <PageHeader
 *     eyebrow={project.name}              // small uppercase label above the title
 *     icon={<Sparkle20Regular />}         // optional left-side icon
 *     title="Ceremonies"                  // the page name
 *     description="Workflows, narratives, and review policies."
 *     actions={<Button>New ceremony</Button>}
 *   />
 *
 * Visual rules:
 *   - Title:        Fluent Subtitle1 (≈16 px, weight 600, var(--text)).
 *   - Eyebrow:      11 px uppercase Caption1, var(--text-muted).
 *   - Description:  Caption1 (12 px), var(--text-muted), one line by default.
 *   - Container:    16 px / 24 px padding, border-bottom var(--border),
 *                   flex row with actions pinned right.
 *
 * Use `size="large"` only on top-level landing pages (Project Picker,
 * global Inbox, etc.) where Title2 is more appropriate than Subtitle1.
 */

import type { ReactNode } from 'react'
import { Subtitle1, Title2, Caption1, tokens } from '@fluentui/react-components'

export interface PageHeaderProps {
  /** Small label above the title — typically the project name. */
  eyebrow?: ReactNode
  /** Page title. Required. */
  title: ReactNode
  /** One-line description rendered below the title. */
  description?: ReactNode
  /** Action buttons / chips rendered to the right of the title. */
  actions?: ReactNode
  /** Visual size. 'standard' (default) for in-project pages; 'large' for top-level landing pages. */
  size?: 'standard' | 'large'
  /** Optional icon rendered to the left of the title. */
  icon?: ReactNode
}

export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  size = 'standard',
  icon,
}: PageHeaderProps) {
  const TitleEl = size === 'large' ? Title2 : Subtitle1

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '16px',
        padding: size === 'large' ? '24px 32px' : '16px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0, flex: 1 }}>
        {icon && (
          <div
            style={{
              flexShrink: 0,
              marginTop: '2px',
              color: tokens.colorNeutralForeground2,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {icon}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          {eyebrow && (
            <Caption1
              style={{
                color: tokens.colorNeutralForeground3,
                display: 'block',
                marginBottom: '2px',
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
                fontSize: '11px',
                fontWeight: 500,
              }}
            >
              {eyebrow}
            </Caption1>
          )}
          <TitleEl as="h1" style={{ display: 'block' }}>
            {title}
          </TitleEl>
          {description && (
            <Caption1
              style={{
                color: tokens.colorNeutralForeground2,
                marginTop: '4px',
                display: 'block',
                lineHeight: 1.4,
              }}
            >
              {description}
            </Caption1>
          )}
        </div>
      </div>
      {actions && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
            paddingTop: '2px',
          }}
        >
          {actions}
        </div>
      )}
    </div>
  )
}
