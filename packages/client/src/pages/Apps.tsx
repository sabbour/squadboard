/**
 * Apps.tsx — First-class Apps marketplace surface (W26).
 *
 * Provides three views via URL search param `?tab=browse|installed`:
 *
 *   Browse    — all built-in bundle templates (GET /api/templates/builtin-projects).
 *               Each card shows icon, name, description, tags, and an "Apply" button.
 *   Installed — projects you've created (each project is an installed squad app).
 *               Links directly into the project dashboard.
 *
 * "Apply" opens an inline dialog: pick a squad path + project name, then calls
 * POST /api/templates/builtin-projects/:bundleId/apply (reuses useApplyBuiltinProjectTemplate).
 *
 * Sync ownership note (shown in help copy):
 *   Squadboard DB is the source of truth for project state.
 *   Disk (.squad/) is a projection written by the CLI.
 *   Run `squad sync` to push hand-edited disk files back into the DB.
 *   The SDK does not live-mirror filesystem changes automatically.
 */

import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router'
import {
  Title3,
  Body1,
  Caption1,
  Button,
  Spinner,
  TabList,
  Tab,
  Field,
  Input,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  tokens,
  makeStyles,
  type SelectTabData,
  type SelectTabEvent,
} from '@fluentui/react-components'
import {
  AppsListDetail24Regular,
  Folder24Regular,
  ArrowRight20Regular,
  Info16Regular,
} from '@fluentui/react-icons'
import { useBuiltinProjectTemplates, useApplyBuiltinProjectTemplate } from '../api/templates.ts'
import type { BuiltinProjectTemplate } from '../api/templates.ts'
import { useProjects } from '../api/projects.ts'
import PageHeader from '../components/layout/PageHeader.tsx'

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXXL}`,
  },
  tabBar: {
    padding: `0 ${tokens.spacingHorizontalXXL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: tokens.spacingVerticalL,
    marginTop: tokens.spacingVerticalL,
  },
  card: {
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  cardIcon: {
    fontSize: '28px',
    lineHeight: 1,
    flexShrink: 0,
  },
  cardActions: {
    marginTop: 'auto',
    paddingTop: tokens.spacingVerticalS,
    display: 'flex',
    justifyContent: 'flex-end',
  },
  tagRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalXS,
  },
  tag: {
    background: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
    borderRadius: tokens.borderRadiusMedium,
    padding: `2px ${tokens.spacingHorizontalS}`,
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingVerticalM,
    padding: '80px 24px',
    textAlign: 'center',
  },
  syncNote: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalS,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    marginTop: tokens.spacingVerticalL,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  projectRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    textDecoration: 'none',
    color: 'inherit',
    transition: 'border-color 0.15s',
  },
  projectRowIcon: {
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  projectList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    marginTop: tokens.spacingVerticalL,
  },
})

type TabValue = 'browse' | 'installed'

export default function Apps() {
  const styles = useStyles()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') as TabValue) ?? 'browse'

  function setTab(t: TabValue) {
    setSearchParams({ tab: t }, { replace: true })
  }

  return (
    <div className={styles.root}>
      <PageHeader
        title="Apps"
        description="Browse built-in squad app templates and apply them to create new projects."
      />

      <div className={styles.tabBar}>
        <TabList
          selectedValue={tab}
          onTabSelect={(_: SelectTabEvent, d: SelectTabData) => setTab(d.value as TabValue)}
        >
          <Tab value="browse" icon={<AppsListDetail24Regular />}>Browse</Tab>
          <Tab value="installed" icon={<Folder24Regular />}>Installed</Tab>
        </TabList>
      </div>

      <div className={styles.body}>
        {tab === 'browse' && <BrowseTab />}
        {tab === 'installed' && <InstalledTab />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Browse tab
// ---------------------------------------------------------------------------

function BrowseTab() {
  const styles = useStyles()
  const { data: bundles = [], isLoading, isError } = useBuiltinProjectTemplates()
  const [applyTarget, setApplyTarget] = useState<BuiltinProjectTemplate | null>(null)

  if (isLoading) {
    return (
      <div className={styles.center}>
        <Spinner label="Loading apps…" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className={styles.center}>
        <Body1 style={{ color: tokens.colorStatusDangerForeground1 }}>
          Failed to load built-in apps.
        </Body1>
      </div>
    )
  }

  if (bundles.length === 0) {
    return (
      <div className={styles.center}>
        <Body1 style={{ color: tokens.colorNeutralForeground3 }}>No built-in apps found.</Body1>
      </div>
    )
  }

  return (
    <>
      <div className={styles.grid}>
        {bundles.map((bundle) => (
          <BundleCard key={bundle.bundleId} bundle={bundle} onApply={() => setApplyTarget(bundle)} />
        ))}
      </div>

      <SyncOwnershipNote />

      {applyTarget && (
        <ApplyDialog
          bundle={applyTarget}
          onClose={() => setApplyTarget(null)}
        />
      )}
    </>
  )
}

function BundleCard({
  bundle,
  onApply,
}: {
  bundle: BuiltinProjectTemplate
  onApply: () => void
}) {
  const styles = useStyles()

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        {bundle.icon && <span className={styles.cardIcon}>{bundle.icon}</span>}
        <Title3 as="h3" style={{ margin: 0 }}>{bundle.name}</Title3>
      </div>

      <Body1 style={{ color: tokens.colorNeutralForeground2 }}>{bundle.description}</Body1>

      {bundle.tags && bundle.tags.length > 0 && (
        <div className={styles.tagRow}>
          {bundle.tags.map((tag) => (
            <span key={tag} className={styles.tag}>{tag}</span>
          ))}
        </div>
      )}

      <Caption1 style={{ color: tokens.colorNeutralForeground4 }}>v{bundle.version}</Caption1>

      <div className={styles.cardActions}>
        <Button appearance="primary" size="small" onClick={onApply}>
          Apply
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Apply dialog
// ---------------------------------------------------------------------------

function ApplyDialog({
  bundle,
  onClose,
}: {
  bundle: BuiltinProjectTemplate
  onClose: () => void
}) {
  const navigate = useNavigate()
  const apply = useApplyBuiltinProjectTemplate()
  const [name, setName] = useState(bundle.name)
  const [squadPath, setSquadPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleApply() {
    if (!name.trim() || !squadPath.trim()) return
    setError(null)
    try {
      const result = await apply.mutateAsync({
        bundleId: bundle.bundleId,
        name: name.trim(),
        squadPath: squadPath.trim(),
      })
      onClose()
      void navigate(`/projects/${result.id}/dashboard`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to apply app')
    }
  }

  const canApply = name.trim().length > 0 && squadPath.trim().length > 0 && !apply.isPending

  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose() }}>
      <DialogSurface style={{ maxWidth: 520, width: '100%' }}>
        <DialogBody>
          <DialogTitle>
            Apply — {bundle.name}
          </DialogTitle>
          <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>
            <Body1 style={{ color: tokens.colorNeutralForeground2 }}>
              {bundle.description}
            </Body1>

            <Field label="Project name" required>
              <Input
                value={name}
                onChange={(_, d) => setName(d.value)}
                placeholder={bundle.name}
              />
            </Field>

            <Field
              label="Squad path"
              hint="Absolute path to the .squad/ directory for this project (e.g. /home/you/myproject/.squad). Squadboard DB is the source of truth; this path is used to write the disk projection."
              required
            >
              <Input
                value={squadPath}
                onChange={(_, d) => setSquadPath(d.value)}
                placeholder="/home/you/myproject/.squad"
              />
            </Field>

            {error && (
              <Body1 style={{ color: tokens.colorStatusDangerForeground1 }}>{error}</Body1>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={apply.isPending}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              onClick={() => void handleApply()}
              disabled={!canApply}
              icon={apply.isPending ? <Spinner size="tiny" /> : undefined}
            >
              {apply.isPending ? 'Applying…' : 'Apply'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Installed tab
// ---------------------------------------------------------------------------

function InstalledTab() {
  const styles = useStyles()
  const { data: projects = [], isLoading, isError } = useProjects()

  if (isLoading) {
    return (
      <div className={styles.center}>
        <Spinner label="Loading projects…" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className={styles.center}>
        <Body1 style={{ color: tokens.colorStatusDangerForeground1 }}>
          Failed to load projects.
        </Body1>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className={styles.center}>
        <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
          No projects yet. Apply an app from the <strong>Browse</strong> tab to get started.
        </Body1>
      </div>
    )
  }

  return (
    <>
      <Body1 style={{ color: tokens.colorNeutralForeground3, marginTop: tokens.spacingVerticalS, display: 'block' }}>
        Each project is a running squad app. Click to open the project dashboard.
      </Body1>

      <div className={styles.projectList}>
        {projects.map((project) => (
          <Link
            key={project.id}
            to={`/projects/${project.id}/dashboard`}
            className={styles.projectRow}
          >
            <Folder24Regular className={styles.projectRowIcon} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Body1 style={{ display: 'block', fontWeight: 600 }}>{project.name}</Body1>
              <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{project.squadPath}</Caption1>
            </div>
            <ArrowRight20Regular style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }} />
          </Link>
        ))}
      </div>

      <SyncOwnershipNote />
    </>
  )
}

// ---------------------------------------------------------------------------
// Shared sync ownership note
// ---------------------------------------------------------------------------

function SyncOwnershipNote() {
  const styles = useStyles()
  return (
    <div className={styles.syncNote}>
      <Info16Regular style={{ flexShrink: 0, marginTop: '2px' }} />
      <span>
        <strong>Sync ownership:</strong> Squadboard DB is the source of truth for all project
        state. The <code>.squad/</code> directory on disk is a projection written by the CLI.
        To push hand-edited disk files back into the DB, run <code>squad sync</code> from the
        project directory. The SDK does not live-mirror filesystem changes automatically.
      </span>
    </div>
  )
}
