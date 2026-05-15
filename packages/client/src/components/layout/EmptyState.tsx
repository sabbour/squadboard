/**
 * EmptyState — Fluent2 empty-state pattern reused across project pages.
 *
 * Mirrors the canon set by Ceremonies' empty state (centred icon + heading +
 * body + primary action) so Skills, Tools, MCP Servers, and any future empty
 * surfaces share the same visual rhythm.
 *
 *   <EmptyState
 *     icon={<BookStar32Regular />}
 *     title="No skills yet"
 *     description="Skills are prompt-augmentation snippets you can assign to agents."
 *     actions={
 *       <>
 *         <Button appearance="secondary" icon={<ArrowUpload20Regular />}>Import</Button>
 *         <Button appearance="secondary">Browse curated</Button>
 *         <Button appearance="primary" icon={<Add20Regular />}>New skill</Button>
 *       </>
 *     }
 *   />
 */

import type { ReactNode } from 'react'
import { Subtitle1, Body1, tokens } from '@fluentui/react-components'

export interface EmptyStateProps {
  /** Optional icon rendered above the title. */
  icon?: ReactNode
  /** Required headline (e.g. "No skills yet"). */
  title: ReactNode
  /** Required short description of what this surface is for. */
  description: ReactNode
  /** Action buttons rendered in a horizontal row beneath the description. */
  actions?: ReactNode
}

export default function EmptyState({ icon, title, description, actions }: EmptyStateProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.spacingVerticalM,
        paddingTop: tokens.spacingVerticalXXL,
        paddingBottom: tokens.spacingVerticalXXL,
        paddingLeft: tokens.spacingHorizontalXXL,
        paddingRight: tokens.spacingHorizontalXXL,
      }}
    >
      {icon && (
        <div
          style={{
            color: tokens.colorNeutralForeground3,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </div>
      )}
      <Subtitle1 style={{ color: tokens.colorNeutralForeground1 }}>
        {title}
      </Subtitle1>
      <Body1 style={{ color: tokens.colorNeutralForeground3, textAlign: 'center', maxWidth: 480 }}>
        {description}
      </Body1>
      {actions && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: tokens.spacingHorizontalS,
            justifyContent: 'center',
            marginTop: tokens.spacingVerticalXS,
          }}
        >
          {actions}
        </div>
      )}
    </div>
  )
}
