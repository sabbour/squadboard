/**
 * SystemGitHubSection — W17 Deliverable 2 (g5-3)
 *
 * Shows GitHub CLI authentication status, required permission matrix,
 * branch convention, and one-click dry-run connectivity tests.
 *
 * Data source: GET /api/system/gh-auth-status (shells to `gh auth status`)
 * Tests:       POST /api/system/gh-test { test: 'push' | 'pr' | 'workflow' }
 *
 * If `gh` is not installed: shows install banner with link to https://cli.github.com/.
 */

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Body1,
  Caption1,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Link,
  tokens,
} from '@fluentui/react-components'
import {
  Checkmark16Regular,
  Dismiss16Regular,
  Warning16Regular,
  Open16Regular,
  ArrowSync20Regular,
  Branch20Regular,
  Key20Regular,
  ShieldCheckmark20Regular,
} from '@fluentui/react-icons'
import { apiFetch } from '../../api/client.ts'
import { SectionLoading } from '../loading/index.tsx'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PermissionRow {
  action: string
  scope: string
  granted: boolean
}

interface GhAuthStatusResponse {
  ok: boolean
  installed: boolean
  authenticated?: boolean
  username?: string | null
  protocol?: string | null
  scopes?: string[]
  permissions?: PermissionRow[]
  raw?: string
}

interface GhTestResponse {
  ok: boolean
  message?: string
  error?: string
}

// ── Small UI atoms ────────────────────────────────────────────────────────────

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        color: ok ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1,
        fontSize: '12px',
        fontWeight: tokens.fontWeightSemibold,
      }}
    >
      {ok ? <Checkmark16Regular /> : <Dismiss16Regular />}
      {label}
    </span>
  )
}

function PermissionTable({ permissions }: { permissions: PermissionRow[] }) {
  const th: React.CSSProperties = {
    textAlign: 'left',
    padding: '6px 12px',
    background: 'var(--surface)',
    color: tokens.colorNeutralForeground3,
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid var(--border)',
  }

  const td: React.CSSProperties = {
    padding: '7px 12px',
    fontSize: '13px',
    borderBottom: '1px solid var(--border)',
    verticalAlign: 'middle',
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)' }}>
      <thead>
        <tr>
          <th style={th}>Action</th>
          <th style={th}>Scope needed</th>
          <th style={th}>Status</th>
        </tr>
      </thead>
      <tbody>
        {permissions.map((row) => (
          <tr key={row.action}>
            <td style={{ ...td, color: tokens.colorNeutralForeground1 }}>{row.action}</td>
            <td style={{ ...td, fontFamily: tokens.fontFamilyMonospace, color: tokens.colorNeutralForeground2 }}>
              {row.scope}
            </td>
            <td style={td}>
              {row.granted ? (
                <StatusBadge ok label="granted" />
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: tokens.colorPaletteYellowForeground1,
                    fontSize: '12px',
                    fontWeight: tokens.fontWeightSemibold,
                  }}
                >
                  <Warning16Regular />
                  missing — Re-authenticate
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Install banner (gh not found) ─────────────────────────────────────────────

function GhInstallBanner() {
  return (
    <MessageBar intent="warning" style={{ borderRadius: '8px' }}>
      <MessageBarBody>
        <MessageBarTitle>GitHub CLI not installed</MessageBarTitle>
        <p style={{ margin: '6px 0 0' }}>
          Squad uses <code style={{ fontFamily: tokens.fontFamilyMonospace }}>gh</code> for all GitHub operations
          (push branch, create PR, merge, comment). Install it to unlock the full Stream G workflow.
        </p>
        <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
          <Link href="https://cli.github.com/" target="_blank" rel="noopener noreferrer">
            <Button appearance="secondary" size="small" icon={<Open16Regular />}>
              Install GitHub CLI
            </Button>
          </Link>
        </div>
      </MessageBarBody>
    </MessageBar>
  )
}

// ── Test result row ───────────────────────────────────────────────────────────

type TestKey = 'push' | 'pr' | 'workflow'

function TestButton({
  label,
  testKey,
  onTest,
  loading,
  result,
}: {
  label: string
  testKey: TestKey
  onTest: (key: TestKey) => void
  loading: boolean
  result: GhTestResponse | null
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <Button
        appearance="secondary"
        size="small"
        icon={loading ? <Spinner size="tiny" /> : <ArrowSync20Regular />}
        disabled={loading}
        onClick={() => onTest(testKey)}
      >
        {loading ? 'Testing…' : label}
      </Button>
      {result && (
        <Caption1
          style={{
            display: 'block',
            color: result.ok ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1,
            maxWidth: 220,
          }}
        >
          {result.ok ? <Checkmark16Regular style={{ verticalAlign: 'middle', marginRight: '4px' }} /> : <Dismiss16Regular style={{ verticalAlign: 'middle', marginRight: '4px' }} />}
          {result.ok ? result.message : result.error}
        </Caption1>
      )}
    </div>
  )
}

// ── SystemGitHubSection (main export) ─────────────────────────────────────────

export function SystemGitHubSection() {
  const [testResults, setTestResults] = useState<Partial<Record<TestKey, GhTestResponse>>>({})
  const [activeTest, setActiveTest] = useState<TestKey | null>(null)

  const { data, isLoading, isError, refetch, isFetching } = useQuery<GhAuthStatusResponse>({
    queryKey: ['system', 'gh-auth-status'],
    queryFn: () => apiFetch('/api/system/gh-auth-status') as Promise<GhAuthStatusResponse>,
    staleTime: 30_000,
    retry: false,
  })

  const testMutation = useMutation({
    mutationFn: async (test: TestKey) => {
      return apiFetch('/api/system/gh-test', {
        method: 'POST',
        body: JSON.stringify({ test }),
      }) as Promise<GhTestResponse>
    },
    onSuccess: (result, test) => {
      setTestResults((prev) => ({ ...prev, [test]: result }))
      setActiveTest(null)
    },
    onError: (err, test) => {
      setTestResults((prev) => ({
        ...prev,
        [test]: { ok: false, error: err instanceof Error ? err.message : 'Test failed' },
      }))
      setActiveTest(null)
    },
  })

  function runTest(key: TestKey) {
    setActiveTest(key)
    setTestResults((prev) => { const next = { ...prev }; delete next[key]; return next })
    testMutation.mutate(key)
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return <SectionLoading label="Checking gh CLI status…" size="small" />
  }

  if (isError || !data) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>Failed to load GitHub integration status.</MessageBarBody>
      </MessageBar>
    )
  }

  // ── gh not installed ───────────────────────────────────────────────────────
  if (!data.installed) {
    return <GhInstallBanner />
  }

  const sectionBox: React.CSSProperties = {
    padding: '16px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  }

  const sectionLabel: React.CSSProperties = {
    display: 'block',
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontWeight: tokens.fontWeightSemibold,
    fontSize: '11px',
    marginBottom: '2px',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: 640 }}>

      {/* ── Authentication ── */}
      <div style={sectionBox}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Key20Regular style={{ color: tokens.colorNeutralForeground3 }} />
          <Body1 style={{ fontWeight: tokens.fontWeightSemibold }}>Authentication</Body1>
          <Button
            appearance="transparent"
            size="small"
            icon={isFetching ? <Spinner size="tiny" /> : <ArrowSync20Regular />}
            onClick={() => void refetch()}
            disabled={isFetching}
            style={{ marginLeft: 'auto' }}
          >
            Refresh
          </Button>
        </div>

        {data.authenticated ? (
          <>
            <Caption1 style={{ display: 'flex', alignItems: 'center', gap: '6px', color: tokens.colorPaletteGreenForeground1 }}>
              <Checkmark16Regular />
              Authenticated as <strong>{data.username ?? '(unknown)'}</strong> via <strong>{data.protocol ?? 'https'}</strong>
            </Caption1>
            {data.scopes && data.scopes.length > 0 && (
              <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
                Scopes: <code style={{ fontFamily: tokens.fontFamilyMonospace }}>{data.scopes.join(', ')}</code>
              </Caption1>
            )}
          </>
        ) : (
          <Caption1 style={{ display: 'flex', alignItems: 'center', gap: '6px', color: tokens.colorPaletteRedForeground1 }}>
            <Dismiss16Regular />
            Not authenticated — run <code style={{ fontFamily: tokens.fontFamilyMonospace }}>gh auth login</code> in your terminal.
          </Caption1>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          <Button
            appearance="secondary"
            size="small"
            onClick={() => {
              // Can't shell interactively from browser — direct to terminal instructions
              window.open('https://cli.github.com/manual/gh_auth_login', '_blank', 'noopener,noreferrer')
            }}
          >
            Re-authenticate
          </Button>
          {data.authenticated && (
            <Button
              appearance="secondary"
              size="small"
              onClick={() => {
                window.open('https://cli.github.com/manual/gh_auth_logout', '_blank', 'noopener,noreferrer')
              }}
            >
              Logout
            </Button>
          )}
        </div>
      </div>

      {/* ── Required permissions ── */}
      {data.permissions && data.permissions.length > 0 && (
        <div style={sectionBox}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheckmark20Regular style={{ color: tokens.colorNeutralForeground3 }} />
            <Body1 style={{ fontWeight: tokens.fontWeightSemibold }}>Required permissions</Body1>
          </div>
          <PermissionTable permissions={data.permissions} />
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
            See{' '}
            <Link href="https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps" target="_blank" rel="noopener noreferrer">
              GitHub OAuth scope docs
            </Link>
            {' '}for details on each scope.
          </Caption1>
        </div>
      )}

      {/* ── Branch convention ── */}
      <div style={sectionBox}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Branch20Regular style={{ color: tokens.colorNeutralForeground3 }} />
          <Body1 style={{ fontWeight: tokens.fontWeightSemibold }}>Branch convention</Body1>
        </div>
        <Caption1 style={sectionLabel}>Agent runs</Caption1>
        <code
          style={{
            display: 'block',
            fontFamily: tokens.fontFamilyMonospace,
            fontSize: '13px',
            color: tokens.colorNeutralForeground1,
            background: 'var(--code-bg, rgba(0,0,0,0.06))',
            padding: '6px 10px',
            borderRadius: '4px',
          }}
        >
          squad/&#123;agent-name&#125;/&#123;slug-from-issue-title&#125;
        </code>
        <Caption1 style={sectionLabel}>Ceremony runs</Caption1>
        <code
          style={{
            display: 'block',
            fontFamily: tokens.fontFamilyMonospace,
            fontSize: '13px',
            color: tokens.colorNeutralForeground1,
            background: 'var(--code-bg, rgba(0,0,0,0.06))',
            padding: '6px 10px',
            borderRadius: '4px',
          }}
        >
          squad/ceremony/&#123;ceremony-slug&#125;-&#123;run-id-suffix&#125;
        </code>
        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
          Protected: <code style={{ fontFamily: tokens.fontFamilyMonospace }}>main</code>,{' '}
          <code style={{ fontFamily: tokens.fontFamilyMonospace }}>master</code>,{' '}
          <code style={{ fontFamily: tokens.fontFamilyMonospace }}>develop</code>,{' '}
          <code style={{ fontFamily: tokens.fontFamilyMonospace }}>trunk</code> — never pushed to.
        </Caption1>
      </div>

      {/* ── Test connectivity ── */}
      <div style={sectionBox}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ArrowSync20Regular style={{ color: tokens.colorNeutralForeground3 }} />
          <Body1 style={{ fontWeight: tokens.fontWeightSemibold }}>Test connectivity</Body1>
        </div>
        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
          Dry-run checks that verify your <code style={{ fontFamily: tokens.fontFamilyMonospace }}>gh</code> token has the
          access needed for each operation.
        </Caption1>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start', marginTop: '4px' }}>
          <TestButton
            label="Test push branch"
            testKey="push"
            onTest={runTest}
            loading={activeTest === 'push'}
            result={testResults['push'] ?? null}
          />
          <TestButton
            label="Test create PR (dry-run)"
            testKey="pr"
            onTest={runTest}
            loading={activeTest === 'pr'}
            result={testResults['pr'] ?? null}
          />
          <TestButton
            label="Test workflow dispatch"
            testKey="workflow"
            onTest={runTest}
            loading={activeTest === 'workflow'}
            result={testResults['workflow'] ?? null}
          />
        </div>
      </div>
    </div>
  )
}
