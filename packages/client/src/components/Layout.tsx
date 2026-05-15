import React, { useState, useEffect } from 'react'
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
  BookStar24Regular,
  Wrench24Regular,
  PlugConnected24Regular,
  ChatHelp24Regular,
  ChatHelp20Regular,
  Eye24Regular,
  Heart24Regular,
  HeartPulse24Regular,
  ChevronDown16Regular,
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
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    flexShrink: 0,
  },
  topBarLeft: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
  },
  topBarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  projectSwitcher: {
    maxWidth: '240px',
    fontWeight: tokens.fontWeightSemibold,
    '& .fui-Button__text': {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  },
})

// Project-scoped sidebar items, grouped by intent.
// Group 1 — Work: where you go to see and do the project's work.
// Group 2 — Squad: who/what is on the team and what they can do.
// Group 3 — Operations: process, recurring rituals, and reporting.
const PROJECT_NAV_GROUPS: Array<{ heading: string; items: Array<{ label: string; segment: string; icon: React.ReactElement }> }> = [
  {
    heading: 'WORK',
    items: [
      { label: 'Dashboard', segment: 'dashboard', icon: <Grid24Regular /> },
      { label: 'Board', segment: 'board', icon: <ClipboardTaskListLtr24Regular /> },
      { label: 'Flow', segment: 'flow', icon: <Flowchart24Regular /> },
    ],
  },
  {
    heading: 'SQUAD',
    items: [
      { label: 'Agents', segment: 'agents', icon: <Bot24Regular /> },
      { label: 'Skills', segment: 'skills', icon: <BookStar24Regular /> },
      { label: 'Tools', segment: 'tools', icon: <Wrench24Regular /> },
      { label: 'MCP Servers', segment: 'mcp-servers', icon: <PlugConnected24Regular /> },
    ],
  },
  {
    heading: 'OPERATIONS',
    items: [
      { label: 'Ceremonies', segment: 'ceremonies', icon: <ArrowSync24Regular /> },
      { label: 'Costs', segment: 'costs', icon: <Money24Regular /> },
    ],
  },
]

const PROJECT_NAV_ITEMS = PROJECT_NAV_GROUPS.flatMap((g) => g.items)

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
  // Phase 17: pressing '?' anywhere navigates to the cross-project Ask page
  // (or the project-scoped one when inside a project).
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null
      const tag = el?.tagName
      return Boolean(
        el?.isContentEditable ||
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT',
      )
    }
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      if (e.key === 'c') {
        e.preventDefault()
        setCaptureOpen(true)
      } else if (e.key === '?') {
        e.preventDefault()
        void navigate(id ? `/projects/${id}/consult/new` : '/consult/new')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, navigate])

  function getSelectedValue(): string {
    if (location.pathname === '/' || location.pathname === '') return 'projects'
    if (location.pathname.startsWith('/now')) return 'now'
    if (location.pathname.startsWith('/diagnostics')) return 'diagnostics'
    if (location.pathname.startsWith('/heartbeat')) return 'heartbeat'
    if (id) {
      // Match longest segment first so 'consult' isn't shadowed by 'flow' etc.
      const matches = PROJECT_NAV_ITEMS
        .filter((item) => location.pathname.includes(`/${item.segment}`))
        .sort((a, b) => b.segment.length - a.segment.length)
      if (matches[0]) return matches[0].segment
      if (location.pathname.includes('/diagnostics')) return 'diagnostics'
      if (location.pathname.includes('/settings')) return 'settings'
    } else if (location.pathname.startsWith('/consult')) {
      // No project is selected but we are inside the global Consult page.
      return 'consult'
    }
    return 'projects'
  }

  function handleNavItemSelect(_: unknown, data: OnNavItemSelectData) {
    const value = data.value as string
    if (value === 'projects') {
      void navigate('/')
    } else if (value === 'now') {
      void navigate('/now')
    } else if (value === 'diagnostics') {
      void navigate(id ? `/projects/${id}/diagnostics` : '/diagnostics')
    } else if (value === 'heartbeat') {
      void navigate('/heartbeat')
    } else if (value === 'consult' && !id) {
      // Cross-project Consult — when no project is selected.
      void navigate('/consult/new')
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
          {/* Phase 19: Now — cross-project live view */}
          <NavItem icon={<Eye24Regular />} value="now">
            Now
          </NavItem>
          <NavItem icon={<ChatHelp24Regular />} value="consult">
            Consult
          </NavItem>

          {/* Phase 3: System / Operations — Diagnostics and Heartbeat */}
          <NavSectionHeader>SYSTEM</NavSectionHeader>
          <NavItem icon={<HeartPulse24Regular />} value="diagnostics">
            Diagnostics
          </NavItem>
          <NavItem icon={<Heart24Regular />} value="heartbeat">
            Heartbeat
          </NavItem>

          {id && (
            <>
              {PROJECT_NAV_GROUPS.map((group) => (
                <div key={group.heading}>
                  <NavSectionHeader>{group.heading}</NavSectionHeader>
                  {group.items.map((item) => (
                    <NavItem key={item.segment} icon={item.icon} value={item.segment}>
                      {item.label}
                    </NavItem>
                  ))}
                </div>
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
          <div className={styles.topBarLeft}>
            {projectName && (
              <Button
                appearance="subtle"
                iconPosition="after"
                icon={<ChevronDown16Regular />}
                className={styles.projectSwitcher}
                onClick={() => void navigate('/')}
                title="Switch project"
              >
                {projectName}
              </Button>
            )}
          </div>
          <div className={styles.topBarRight}>
            <Button
              appearance="subtle"
              icon={<Mail20Regular />}
              onClick={() => navigate(id ? `/projects/${id}/inbox` : '/inbox')}
              title="Inbox"
            >
              Inbox
            </Button>
            <Button
              appearance="subtle"
              icon={<ChatHelp20Regular />}
              onClick={() => navigate(id ? `/projects/${id}/consult/new` : '/consult/new')}
              title="Consult (press ?)"
            >
              Consult
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
        </div>
        <Outlet />
      </main>

      <CaptureModal open={captureOpen} onClose={() => setCaptureOpen(false)} />
    </div>
  )
}
