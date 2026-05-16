/**
 * GitHubActivityFeed — G6.5 (Wave 21)
 *
 * Cursor-paginated list of recent GitHub events for a project.
 * Data source: GET /api/projects/:id/github/activity
 *
 * Renders a minimal timeline: icon + actor + description + relative timestamp + link.
 * Designed to be embedded in the Project Settings page under a "GitHub Activity" accordion.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Body1,
  Body2,
  Caption1,
  Button,
  Spinner,
  Link,
  Avatar,
  tokens,
} from '@fluentui/react-components'
import {
  BranchFork20Regular,
  CheckmarkCircle20Regular,
  Dismiss20Regular,
  Comment20Regular,
  ArrowUpload20Regular,
  Play20Regular,
  Tag20Regular,
  QuestionCircle20Regular,
  Open16Regular,
} from '@fluentui/react-icons'
import { apiFetch } from '../api/client.ts'
import { SectionLoading } from './loading/index.tsx'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActivityItem {
  id: string
  eventType: string
  action: string | null
  actor: string | null
  avatarUrl: string | null
  link: string | null
  title: string | null
  receivedAt: string
  runId: string | null
  gitBranch: string | null
  prNumber: number | null
  prUrl: string | null
  ciState: string | null
}

interface ActivityPage {
  items: ActivityItem[]
  nextCursor: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function eventIcon(eventType: string, action: string | null) {
  if (eventType === 'push') return <ArrowUpload20Regular />
  if (eventType === 'pull_request') {
    if (action === 'closed') return <CheckmarkCircle20Regular style={{ color: tokens.colorPalettePurpleForeground2 }} />
    if (action === 'opened') return <BranchFork20Regular style={{ color: tokens.colorPaletteGreenForeground1 }} />
    return <BranchFork20Regular />
  }
  if (eventType === 'pull_request_review' || eventType === 'pull_request_review_comment') {
    return <Comment20Regular />
  }
  if (eventType === 'issue_comment') return <Comment20Regular />
  if (eventType === 'issues') {
    if (action === 'closed') return <Dismiss20Regular />
    return <Tag20Regular />
  }
  if (eventType === 'workflow_run') return <Play20Regular />
  if (eventType === 'check_run') return <CheckmarkCircle20Regular />
  return <QuestionCircle20Regular />
}

function eventLabel(item: ActivityItem): string {
  const { eventType, action, title, prNumber } = item
  const titleSnippet = title ? ` "${title.slice(0, 60)}${title.length > 60 ? '…' : ''}"` : ''
  if (eventType === 'push') return `pushed`
  if (eventType === 'pull_request') {
    const prSuffix = prNumber ? ` #${prNumber}` : ''
    if (action === 'opened') return `opened PR${prSuffix}${titleSnippet}`
    if (action === 'closed') return `merged PR${prSuffix}${titleSnippet}`
    if (action === 'synchronize') return `pushed to PR${prSuffix}`
    return `${action ?? ''} PR${prSuffix}${titleSnippet}`
  }
  if (eventType === 'issues') return `${action ?? ''} issue${titleSnippet}`
  if (eventType === 'issue_comment') return `commented`
  if (eventType === 'pull_request_review') return `reviewed PR${item.prNumber ? ` #${item.prNumber}` : ''}`
  if (eventType === 'workflow_run') return `workflow ${action ?? ''}`
  if (eventType === 'check_run') return `check ${action ?? ''}`
  return `${eventType}${action ? `.${action}` : ''}`
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
}

export function GitHubActivityFeed({ projectId }: Props) {
  const [cursor, setCursor] = useState<string | null>(null)
  const [allItems, setAllItems] = useState<ActivityItem[]>([])

  const { isLoading, isFetching, isError } = useQuery({
    queryKey: ['github-activity', projectId, cursor],
    queryFn: async () => {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      const page = await apiFetch(`/api/projects/${projectId}/github/activity${qs}`) as ActivityPage
      if (cursor) {
        // Append on load-more
        setAllItems((prev) => [...prev, ...page.items])
      } else {
        setAllItems(page.items)
      }
      return page
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const { data } = useQuery<ActivityPage>({
    queryKey: ['github-activity', projectId, cursor],
    enabled: false, // already fetched above; just read the cache
  })

  if (isLoading && allItems.length === 0) return <SectionLoading />

  if (isError && allItems.length === 0) {
    return (
      <Body2 style={{ color: tokens.colorStatusDangerForeground1 }}>
        Could not load GitHub activity. Ensure the project has GitHub sync configured.
      </Body2>
    )
  }

  if (!isLoading && allItems.length === 0) {
    return <Body2 style={{ color: tokens.colorNeutralForeground3 }}>No GitHub events recorded yet.</Body2>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {allItems.map((item) => (
        <div
          key={item.id}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '8px 0',
            borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
          }}
        >
          {/* Avatar / icon */}
          <div style={{ flexShrink: 0, paddingTop: 2 }}>
            {item.avatarUrl ? (
              <Avatar image={{ src: item.avatarUrl }} size={24} name={item.actor ?? undefined} />
            ) : (
              <span style={{ color: tokens.colorNeutralForeground3 }}>
                {eventIcon(item.eventType, item.action)}
              </span>
            )}
          </div>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Body1>
              {item.actor && (
                <strong style={{ marginRight: 4 }}>{item.actor}</strong>
              )}
              {eventLabel(item)}
            </Body1>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                {relativeTime(item.receivedAt)}
              </Caption1>

              {item.link && (
                <Link href={item.link} target="_blank" rel="noopener noreferrer">
                  <Open16Regular style={{ verticalAlign: 'middle' }} />
                </Link>
              )}

              {item.ciState && item.ciState !== 'unknown' && (
                <Caption1
                  style={{
                    color: item.ciState === 'passing'
                      ? tokens.colorPaletteGreenForeground1
                      : item.ciState === 'failing'
                        ? tokens.colorStatusDangerForeground1
                        : tokens.colorNeutralForeground3,
                  }}
                >
                  CI: {item.ciState}
                </Caption1>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Load-more button */}
      {data?.nextCursor && (
        <Button
          appearance="subtle"
          onClick={() => {
            if (data.nextCursor) setCursor(data.nextCursor)
          }}
          disabled={isFetching}
          style={{ alignSelf: 'center', marginTop: 8 }}
        >
          {isFetching ? <Spinner size="tiny" /> : 'Load more'}
        </Button>
      )}
    </div>
  )
}
