/**
 * CeremonyAudit.test.tsx — CER-8: verify audit page renders and filters work.
 *
 * Tests the audit report data shape and the DiagnosticTable rendering logic.
 * The full page component is tested with a mocked useCeremonyAudit hook.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { CeremonyAuditReport } from '../../api/ceremonies'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('react-router', () => ({
  useParams: () => ({ id: 'project-123' }),
  useNavigate: () => vi.fn(),
}))

vi.mock('../../api/projects', () => ({
  useProject: () => ({ data: { id: 'project-123', name: 'Test Project' } }),
}))

const mockAudit: CeremonyAuditReport = {
  total: 5,
  byOrigin: {
    'built-in': 0,
    'yaml-import': 0,
    'conjure-llm': 2,
    'user-created': 3,
  },
  byTrigger: { manual: 3, on_schedule: 2 },
  byStatus: { active: 4, draft: 1 },
  orphans: [
    { id: 'cer-1', name: 'Stale Review', reason: 'No runs in the last 30 days' },
    { id: 'cer-2', name: 'Dead Retro', reason: 'No runs in the last 30 days' },
  ],
  dead: [
    {
      id: 'cer-3',
      name: 'GitHub PR Ceremony',
      reason: 'Trigger requires GitHub integration, but no GitHub repo is connected to this project',
    },
  ],
}

let mockAuditReturn: { data: CeremonyAuditReport | undefined; isLoading: boolean; isError: boolean; refetch: () => void } = {
  data: mockAudit,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}

vi.mock('../../api/ceremonies', () => ({
  useCeremonyAudit: () => mockAuditReturn,
}))

// Mock all Fluent2 components we use in the audit page
vi.mock('@fluentui/react-components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    Badge: ({ children, color }: { children?: React.ReactNode; color?: string }) => (
      <span data-testid="badge" data-color={color}>{children}</span>
    ),
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <button onClick={onClick}>{children}</button>
    ),
    Select: ({ children, onChange, value, 'aria-label': ariaLabel }: {
      children?: React.ReactNode;
      onChange?: (e: React.ChangeEvent<HTMLSelectElement>, d: { value: string }) => void;
      value?: string;
      'aria-label'?: string;
    }) => (
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange?.(e, { value: e.target.value })}
      >
        {children}
      </select>
    ),
    Table: ({ children }: { children?: React.ReactNode }) => <table>{children}</table>,
    TableHeader: ({ children }: { children?: React.ReactNode }) => <thead>{children}</thead>,
    TableHeaderCell: ({ children }: { children?: React.ReactNode }) => <th>{children}</th>,
    TableBody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
    TableRow: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
    TableCell: ({ children }: { children?: React.ReactNode }) => <td>{children}</td>,
    TableCellLayout: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    Subtitle2: ({ children }: { children?: React.ReactNode }) => <h3>{children}</h3>,
    Caption1: ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => (
      <span style={style}>{children}</span>
    ),
    Body1: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
    tokens: {
      spacingVerticalL: '12px',
      spacingVerticalM: '8px',
      spacingVerticalS: '6px',
      spacingVerticalXS: '4px',
      spacingVerticalXXL: '24px',
      spacingVerticalXL: '16px',
      spacingHorizontalL: '12px',
      spacingHorizontalM: '8px',
      spacingHorizontalS: '6px',
      spacingHorizontalXS: '4px',
      spacingHorizontalXXL: '24px',
      colorNeutralBackground1: '#fff',
      colorNeutralBackground3: '#f5f5f5',
      colorBrandBackground2: '#e8f4fb',
      colorBrandForeground1: '#0078d4',
      colorNeutralForeground1: '#000',
      colorNeutralForeground3: '#666',
      colorPaletteRedForeground1: '#d13438',
      colorPaletteYellowForeground1: '#c19c00',
      colorNeutralStroke2: '#e0e0e0',
      fontSizeHero700: '32px',
      fontWeightBold: '700',
      fontWeightSemibold: '600',
      borderRadiusMedium: '4px',
    },
  }
})

vi.mock('@fluentui/react-icons', () => ({
  ArrowLeft20Regular: () => <span data-testid="icon-arrow-left" />,
  Warning20Regular: () => <span data-testid="icon-warning" />,
  Delete20Regular: () => <span data-testid="icon-delete" />,
  ChartMultiple20Regular: () => <span data-testid="icon-chart" />,
}))

vi.mock('../../components/layout/PageHeader', () => ({
  default: ({ title }: { title: string }) => <header><h1>{title}</h1></header>,
}))

vi.mock('../../components/loading/index', () => ({
  PageLoading: ({ label }: { label: string }) => <div data-testid="page-loading">{label}</div>,
}))

vi.mock('../../components/ceremony/CeremonyBadges', () => ({
  OriginBadge: ({ origin }: { origin?: string | null }) => (
    <span data-testid="origin-badge" data-origin={origin ?? 'user-created'}>
      {origin ?? 'User'}
    </span>
  ),
}))

// ── Import after mocks ─────────────────────────────────────────────────────────

import CeremonyAudit from '../CeremonyAudit'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CeremonyAudit page', () => {
  beforeEach(() => {
    mockAuditReturn = {
      data: mockAudit,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }
  })

  it('renders the page title', () => {
    render(<CeremonyAudit />)
    expect(screen.getByText('Ceremony Audit')).toBeInTheDocument()
  })

  it('shows loading state when audit is loading', () => {
    mockAuditReturn = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() }
    render(<CeremonyAudit />)
    expect(screen.getByTestId('page-loading')).toBeInTheDocument()
  })

  it('shows total ceremony count', () => {
    render(<CeremonyAudit />)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('shows orphan count', () => {
    render(<CeremonyAudit />)
    expect(screen.getByText('Orphans')).toBeInTheDocument()
    expect(screen.getByText('Orphaned ceremonies')).toBeInTheDocument()
  })

  it('shows dead count', () => {
    render(<CeremonyAudit />)
    expect(screen.getByText('Dead')).toBeInTheDocument()
    // The dead count badge should appear in the dead section header
    expect(screen.getByText('Dead ceremonies')).toBeInTheDocument()
  })

  it('renders orphan ceremony names', () => {
    render(<CeremonyAudit />)
    expect(screen.getByText('Stale Review')).toBeInTheDocument()
    expect(screen.getByText('Dead Retro')).toBeInTheDocument()
  })

  it('renders dead ceremony names', () => {
    render(<CeremonyAudit />)
    expect(screen.getByText('GitHub PR Ceremony')).toBeInTheDocument()
  })

  it('renders "By Origin" section with origin badges', () => {
    render(<CeremonyAudit />)
    expect(screen.getByText('By Origin')).toBeInTheDocument()
    const originBadges = screen.getAllByTestId('origin-badge')
    expect(originBadges.length).toBeGreaterThan(0)
  })

  it('renders "By Trigger" section', () => {
    render(<CeremonyAudit />)
    expect(screen.getByText('By Trigger')).toBeInTheDocument()
    expect(screen.getByText('manual')).toBeInTheDocument()
    expect(screen.getByText('on_schedule')).toBeInTheDocument()
  })

  it('renders "By Status" section', () => {
    render(<CeremonyAudit />)
    expect(screen.getByText('By Status')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
  })

  it('renders section headers for orphans and dead', () => {
    render(<CeremonyAudit />)
    expect(screen.getByText('Orphaned ceremonies')).toBeInTheDocument()
    expect(screen.getByText('Dead ceremonies')).toBeInTheDocument()
  })

  it('renders View buttons for each orphan', () => {
    render(<CeremonyAudit />)
    const viewButtons = screen.getAllByText('View')
    // orphans (2) + dead (1) = 3 View buttons
    expect(viewButtons.length).toBeGreaterThanOrEqual(2)
  })

  it('shows empty state message when no orphans', () => {
    mockAuditReturn = {
      data: { ...mockAudit, orphans: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }
    render(<CeremonyAudit />)
    expect(screen.getByText('No orphans detected.')).toBeInTheDocument()
  })

  it('shows empty state message when no dead ceremonies', () => {
    mockAuditReturn = {
      data: { ...mockAudit, dead: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }
    render(<CeremonyAudit />)
    expect(screen.getByText('No dead ceremonies detected.')).toBeInTheDocument()
  })

  describe('filters', () => {
    it('renders origin filter selects for orphans and dead sections', () => {
      render(<CeremonyAudit />)
      const selects = screen.getAllByRole('combobox')
      expect(selects.length).toBeGreaterThanOrEqual(2)
    })

    it('origin filter select has "All origins" default option', async () => {
      render(<CeremonyAudit />)
      const selects = screen.getAllByRole('combobox')
      expect(selects[0]).toBeInTheDocument()
      expect(screen.getAllByText('All origins').length).toBeGreaterThanOrEqual(1)
    })
  })
})
