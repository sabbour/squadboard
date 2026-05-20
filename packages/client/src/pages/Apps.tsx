import { useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Title3,
  Body1,
  Caption1,
  Button,
  Spinner,
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
} from '@fluentui/react-components'
import {
  Info16Regular,
  Warning20Regular,
} from '@fluentui/react-icons'
import {
  useApplySquadboardApp,
  useInstallSquadboardAppFromGithub,
  useSquadboardApps,
} from '../api/templates.ts'
import type { SquadboardAppTemplate } from '../api/templates.ts'
import PageHeader from '../components/layout/PageHeader.tsx'
import BrowseFolderButton from '../components/BrowseFolderButton.tsx'

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
  section: {
    marginBottom: tokens.spacingVerticalXXL,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalM,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: tokens.spacingVerticalL,
    alignItems: 'stretch',
  },
  card: {
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    minHeight: '220px',
    height: '100%',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
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
    padding: '48px 24px',
    textAlign: 'center',
  },
  note: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalS,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  warning: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalS,
    background: tokens.colorStatusWarningBackground1,
    border: `1px solid ${tokens.colorStatusWarningBorder1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  githubPanel: {
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: tokens.spacingVerticalL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
})

export default function Apps() {
  const styles = useStyles()
  const { data: apps = [], isLoading, isError } = useSquadboardApps()
  const [applyTarget, setApplyTarget] = useState<SquadboardAppTemplate | null>(null)

  return (
    <div className={styles.root}>
      <PageHeader
        title="Squadboard Apps"
        description="Install specific domain packages as new Squadboard projects. Generic, repeatable Project Templates stay under Projects -> Create from template."
      />

      <div className={styles.body}>
        <section className={styles.section}>
          <InstallFromGithubPanel />
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <Title3 as="h2">Available locally</Title3>
              <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: tokens.spacingVerticalXXS }}>
                Reference apps included with this checkout or staged in the local <code>squadboard-apps/</code> folder.
              </Caption1>
            </div>
          </div>

          {isLoading && (
            <div className={styles.center}>
              <Spinner label="Loading Squadboard Apps..." />
            </div>
          )}

          {isError && (
            <div className={styles.center}>
              <Body1 style={{ color: tokens.colorStatusDangerForeground1 }}>
                Failed to load local Squadboard Apps.
              </Body1>
            </div>
          )}

          {!isLoading && !isError && apps.length === 0 && (
            <div className={styles.note}>
              <Info16Regular style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>
                No local Squadboard Apps are available in this checkout yet. Use the GitHub installer above,
                or clone example apps into <code>squadboard-apps/</code>.
              </span>
            </div>
          )}

          {!isLoading && !isError && apps.length > 0 && (
            <div className={styles.grid}>
              {apps.map((app) => (
                <AppCard key={app.bundleId} app={app} onInstall={() => setApplyTarget(app)} />
              ))}
            </div>
          )}
        </section>

        <SyncOwnershipNote />
      </div>

      {applyTarget && (
        <ApplyDialog
          app={applyTarget}
          onClose={() => setApplyTarget(null)}
        />
      )}
    </div>
  )
}

function InstallFromGithubPanel() {
  const styles = useStyles()
  const navigate = useNavigate()
  const install = useInstallSquadboardAppFromGithub()
  const [repoUrl, setRepoUrl] = useState('https://github.com/sabbour/squadboard-apps')
  const [appPath, setAppPath] = useState('')
  const [ref, setRef] = useState('')
  const [name, setName] = useState('')
  const [squadPath, setSquadPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleInstall() {
    if (!repoUrl.trim() || !name.trim() || !squadPath.trim()) return
    setError(null)
    try {
      const result = await install.mutateAsync({
        repoUrl: repoUrl.trim(),
        appPath: appPath.trim() || undefined,
        ref: ref.trim() || undefined,
        name: name.trim(),
        squadPath: squadPath.trim(),
      })
      void navigate(`/projects/${result.id}/dashboard`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to install Squadboard App')
    }
  }

  const canInstall = repoUrl.trim().length > 0 && name.trim().length > 0 && squadPath.trim().length > 0 && !install.isPending

  return (
    <div className={styles.githubPanel}>
      <div>
        <Title3 as="h2">Install from GitHub</Title3>
        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: tokens.spacingVerticalXXS }}>
          Point to a GitHub repo that contains a Squadboard App. Squadboard clones the repo, reads the bundle, and creates a normal project.
        </Caption1>
      </div>

      <div className={styles.warning}>
        <Warning20Regular style={{ flexShrink: 0, marginTop: '1px' }} />
        <span>
          Only install Squadboard Apps from sources you trust. Unknown repos can add agent prompts,
          ceremonies, skills, tools, MCP server recipes, and seed work to the new project. Review
          the source before installing.
        </span>
      </div>

      <Field label="GitHub repository URL" required>
        <Input value={repoUrl} onChange={(_, d) => setRepoUrl(d.value)} placeholder="https://github.com/sabbour/squadboard-apps" />
      </Field>
      <Field label="App folder" hint="Folder inside the repo that contains squad-bundle.json. Leave empty if the app is at the repo root.">
        <Input value={appPath} onChange={(_, d) => setAppPath(d.value)} placeholder="squad-doc-review" />
      </Field>
      <Field label="Git ref" hint="Optional branch or tag. Defaults to the repository default branch.">
        <Input value={ref} onChange={(_, d) => setRef(d.value)} placeholder="main" />
      </Field>
      <Field label="Project name" required>
        <Input value={name} onChange={(_, d) => setName(d.value)} placeholder="Squad Doc Review" />
      </Field>
      <Field label="Absolute project folder or .squad path" hint="Use an absolute path. If you provide a project folder, Squadboard creates .squad/ inside it." required>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Input style={{ flex: 1 }} value={squadPath} onChange={(_, d) => setSquadPath(d.value)} placeholder="/home/you/projects/squad-doc-review" />
          <BrowseFolderButton onPath={setSquadPath} />
        </div>
      </Field>

      {error && <Body1 style={{ color: tokens.colorStatusDangerForeground1 }}>{error}</Body1>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          appearance="primary"
          onClick={() => void handleInstall()}
          disabled={!canInstall}
          icon={install.isPending ? <Spinner size="tiny" /> : undefined}
        >
          {install.isPending ? 'Installing...' : 'Install as project'}
        </Button>
      </div>
    </div>
  )
}

function AppCard({
  app,
  onInstall,
}: {
  app: SquadboardAppTemplate
  onInstall: () => void
}) {
  const styles = useStyles()

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <Title3 as="h3" style={{ margin: 0 }}>{app.name}</Title3>
      </div>

      <Body1 style={{ color: tokens.colorNeutralForeground2 }}>{app.description}</Body1>

      {app.tags && app.tags.length > 0 && (
        <div className={styles.tagRow}>
          {app.tags.map((tag) => (
            <span key={tag} className={styles.tag}>{tag}</span>
          ))}
        </div>
      )}

      <Caption1 style={{ color: tokens.colorNeutralForeground4 }}>v{app.version}</Caption1>

      <div className={styles.cardActions}>
        <Button appearance="primary" size="small" onClick={onInstall}>
          Install as project
        </Button>
      </div>
    </div>
  )
}

function ApplyDialog({
  app,
  onClose,
}: {
  app: SquadboardAppTemplate
  onClose: () => void
}) {
  const navigate = useNavigate()
  const apply = useApplySquadboardApp()
  const [name, setName] = useState(app.name)
  const [squadPath, setSquadPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleApply() {
    if (!name.trim() || !squadPath.trim()) return
    setError(null)
    try {
      const result = await apply.mutateAsync({
        bundleId: app.bundleId,
        name: name.trim(),
        squadPath: squadPath.trim(),
      })
      onClose()
      void navigate(`/projects/${result.id}/dashboard`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to install Squadboard App')
    }
  }

  const canApply = name.trim().length > 0 && squadPath.trim().length > 0 && !apply.isPending

  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose() }}>
      <DialogSurface style={{ maxWidth: 520, width: '100%' }}>
        <DialogBody>
          <DialogTitle>Install Squadboard App - {app.name}</DialogTitle>
          <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>
            <Body1 style={{ color: tokens.colorNeutralForeground2 }}>{app.description}</Body1>

            <Field label="Project name" required>
              <Input value={name} onChange={(_, d) => setName(d.value)} placeholder={app.name} />
            </Field>

            <Field label="Absolute project folder or .squad path" hint="Use an absolute path. If you provide a project folder, Squadboard creates .squad/ inside it." required>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <Input style={{ flex: 1 }} value={squadPath} onChange={(_, d) => setSquadPath(d.value)} placeholder="/home/you/projects/my-app-project" />
                <BrowseFolderButton onPath={setSquadPath} />
              </div>
            </Field>

            {error && <Body1 style={{ color: tokens.colorStatusDangerForeground1 }}>{error}</Body1>}
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
              {apply.isPending ? 'Installing...' : 'Install as project'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

function SyncOwnershipNote() {
  const styles = useStyles()
  return (
    <div className={styles.note}>
      <Info16Regular style={{ flexShrink: 0, marginTop: '2px' }} />
      <span>
        <strong>Sync ownership:</strong> a Squadboard App creates a normal project. Squadboard state and
        repository <code>.squad/</code> files stay interchangeable: start in either client, then use sync
        to reconcile changes so the other surface can continue the same work.
      </span>
    </div>
  )
}
