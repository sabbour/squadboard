import { useState, useEffect } from 'react'
import { Outlet, useParams, useNavigate, useLocation } from 'react-router'
import { apiFetch } from '../api/client.ts'
import squadboardLogo from '../assets/squadboard-horizontal.png'
import {
  NavDrawer,
  NavDrawerBody,
  NavDrawerFooter,
  NavItem,
  NavSectionHeader,
  Button,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import {
  Home24Regular,
  Grid24Regular,
  ClipboardTaskListLtr24Regular,
  Bot24Regular,
  ArrowSync24Regular,
  Money24Regular,
  Settings24Regular,
  Add20Regular,
  Mail20Regular,
  Flowchart24Regular,
} from '@fluentui/react-icons'
import type { OnNavItemSelectData } from '@fluentui/react-components'
import CaptureModal from './inbox/CaptureModal.tsx'

const useStyles = makeStyles({
  root: {
    display: 'flex',
    height: '100%',
    minHeight: 0,
  },
  sidebarLogo: {
    padding: '16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    display: 'flex',
    alignItems: 'center',
  },
  main: {
    flex: '1',
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
  },
  navDrawer: {
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    '& nav': {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    },
  },
  projectName: {
    padding: '4px 12px 8px',
    fontWeight: 700,
    fontSize: '14px',
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '8px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    flexShrink: 0,
  },
})

const PROJECT_NAV_ITEMS = [
  { label: 'Dashboard', segment: 'dashboard', icon: <Grid24Regular /> },
  { label: 'Board', segment: 'board', icon: <ClipboardTaskListLtr24Regular /> },
  { label: 'Flow', segment: 'flow', icon: <Flowchart24Regular /> },
  { label: 'Agents', segment: 'agents', icon: <Bot24Regular /> },
  { label: 'Ceremonies', segment: 'ceremonies', icon: <ArrowSync24Regular /> },
  { label: 'Costs', segment: 'costs', icon: <Money24Regular /> },
]

export default function Layout() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const styles = useStyles()

  const [projectName, setProjectName] = useState<string | null>(null)
  const [captureOpen, setCaptureOpen] = useState(false)

  useEffect(() => {
    if (!id) { setProjectName(null); return }
    apiFetch<{ id: string; name: string; path: string }>(`/api/projects/${id}`)
      .then((p) => setProjectName(p.name))
      .catch(() => setProjectName(null))
  }, [id])

  // Phase 14: pressing 'c' anywhere opens the quick-capture modal as long
  // as the user isn't typing in another input.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'c' || e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (
        target?.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT'
      ) {
        return
      }
      e.preventDefault()
      setCaptureOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function getSelectedValue(): string {
    if (location.pathname === '/' || location.pathname === '') return 'projects'
    if (id) {
      for (const item of PROJECT_NAV_ITEMS) {
        if (location.pathname.includes(`/${item.segment}`)) return item.segment
      }
      if (location.pathname.includes('/settings')) return 'settings'
    }
    return 'projects'
  }

  function handleNavItemSelect(_: unknown, data: OnNavItemSelectData) {
    const value = data.value as string
    if (value === 'projects') {
      void navigate('/')
    } else if (id) {
      void navigate(`/projects/${id}/${value}`)
    }
  }

  return (
    <div className={styles.root}>
      <NavDrawer
        open
        type="inline"
        size="small"
        selectedValue={getSelectedValue()}
        onNavItemSelect={handleNavItemSelect}
        className={styles.navDrawer}
      >
        {/* Logo / wordmark */}
        <div className={styles.sidebarLogo}>
          <img src={squadboardLogo} alt="Squadboard" style={{ height: '44px', display: 'block' }} />
        </div>

        <NavDrawerBody>
          <NavItem icon={<Home24Regular />} value="projects">
            Projects
          </NavItem>

          {id && (
            <>
              <NavSectionHeader>PROJECT</NavSectionHeader>
              {projectName && (
                <div className={styles.projectName}>{projectName}</div>
              )}
              {PROJECT_NAV_ITEMS.map((item) => (
                <NavItem key={item.segment} icon={item.icon} value={item.segment}>
                  {item.label}
                </NavItem>
              ))}
            </>
          )}
        </NavDrawerBody>

        {id && (
          <NavDrawerFooter>
            <NavItem icon={<Settings24Regular />} value="settings">
              Settings
            </NavItem>
          </NavDrawerFooter>
        )}
      </NavDrawer>

      {/* Main content */}
      <main className={styles.main}>
        <div className={styles.topBar}>
          <Button
            appearance="subtle"
            icon={<Mail20Regular />}
            onClick={() => navigate('/inbox')}
            title="Inbox"
          >
            Inbox
          </Button>
          <Button
            appearance="primary"
            icon={<Add20Regular />}
            onClick={() => setCaptureOpen(true)}
            title="Quick capture (press c)"
          >
            Capture
          </Button>
        </div>
        <Outlet />
      </main>

      <CaptureModal open={captureOpen} onClose={() => setCaptureOpen(false)} />
    </div>
  )
}
