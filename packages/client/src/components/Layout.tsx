import React, { useState, useEffect, useMemo } from 'react'
import { Outlet, useParams, useNavigate, useLocation } from 'react-router'
import { apiFetch } from '../api/client.ts'
import { useProjects } from '../api/projects.ts'
import squadboardLogo from '../assets/squadboard-horizontal.png'
import {
  NavDrawer,
  NavDrawerBody,
  NavDrawerFooter,
  NavItem,
  NavSectionHeader,
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
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
  DocumentBulletList24Regular,
} from '@fluentui/react-icons'
import type { OnNavItemSelectData } from '@fluentui/react-components'

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
    // Wave 10 C4: long project names (e.g. "Content Creation Workflow — Squad Edition")
    // were wrapping in the top bar. Cap at 320px and force single-line ellipsis;
    // tooltip on the button surfaces the full name.
    minWidth: '180px',
    maxWidth: '320px',
    fontWeight: tokens.fontWeightSemibold,
    '& .fui-Button__text': {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      display: 'block',
    },
  },
  projectSwitcherPopover: {
    // Match the trigger so single-line names don't wrap inside the menu either.
    minWidth: '280px',
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
      { label: 'Templates', segment: 'ceremonies/templates', icon: <DocumentBulletList24Regular /> },
      { label: 'Costs', segment: 'costs', icon: <Money24Regular /> },
    ],
  },
]

const PROJECT_NAV_ITEMS = PROJECT_NAV_GROUPS.flatMap((g) => g.items)

// Set of route segments that exist under /projects/:id/<segment>. Used by the
// project switcher to decide whether the current category can be preserved
// when the user picks a different project.
const PROJECT_SCOPED_SEGMENTS: ReadonlySet<string> = new Set([
  ...PROJECT_NAV_ITEMS.map((item) => item.segment),
  'settings',
  'inbox',
  'consult',
  'diagnostics',
  'ceremonies', // already in PROJECT_NAV_ITEMS but explicit for clarity
])

/**
 * Given the current pathname, return the project-scoped category segment
 * (e.g. 'board', 'flow', 'agents') if the URL is under `/projects/:id/...`,
 * or `null` otherwise. Sub-paths beyond the segment are intentionally
 * dropped — switching projects lands on the category root for the new
 * project, not on a stale sub-resource id that won't exist in the target.
 */
function extractProjectCategory(pathname: string, currentProjectId: string | undefined): string | null {
  if (!currentProjectId) return null
  const prefix = `/projects/${currentProjectId}/`
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  const seg = rest.split('/')[0] ?? ''
  if (!seg) return null
  return PROJECT_SCOPED_SEGMENTS.has(seg) ? seg : null
}

export default function Layout() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const styles = useStyles()

  const [projectName, setProjectName] = useState<string | null>(null)
  const projectsQuery = useProjects()
  const projects = projectsQuery.data

  // Sorted alphabetically; the active project is filtered out of the menu.
  const switcherProjects = useMemo(() => {
    if (!projects) return []
    return [...projects]
      .filter((p) => p.id !== id)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [projects, id])

  // The category segment we want to preserve when switching projects.
  const currentCategory = useMemo(
    () => extractProjectCategory(location.pathname, id),
    [location.pathname, id],
  )

  function handleProjectSwitch(newProjectId: string) {
    if (currentCategory) {
      void navigate(`/projects/${newProjectId}/${currentCategory}`)
    } else {
      // Fall back to the project home (Dashboard) when the current route
      // doesn't map to a recognised project-scoped category.
      void navigate(`/projects/${newProjectId}/dashboard`)
    }
  }

  useEffect(() => {
    if (!id) { setProjectName(null); return }
    apiFetch<{ id: string; name: string; path: string }>(`/api/projects/${id}`)
      .then((p) => setProjectName(p.name))
      .catch(() => setProjectName(null))
  }, [id])

  // Wave 10 B2: 'c' (legacy Capture shortcut) and '?' both route into Conjure
  // — i.e. the Consult /new entry point that owns raw input + classification.
  // Capture is deprecated; the global "+ Capture" button has been removed
  // from the top bar (only the per-project Board FAB remains as a shim).
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
      if (e.key === 'c' || e.key === '?') {
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
            Conjure
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

          {/* Spacer — pushes the SYSTEM section to the visual bottom of the
              sidebar regardless of how many project groups are above it. */}
          <div style={{ flex: 1 }} />

          {/* Phase 3: System / Operations — Diagnostics and Heartbeat.
              Anchored to the bottom of the sidebar so project-scoped categories
              come first. */}
          <NavSectionHeader>SYSTEM</NavSectionHeader>
          <NavItem icon={<HeartPulse24Regular />} value="diagnostics">
            Diagnostics
          </NavItem>
          <NavItem icon={<Heart24Regular />} value="heartbeat">
            Heartbeat
          </NavItem>
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
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button
                    appearance="subtle"
                    iconPosition="after"
                    icon={<ChevronDown16Regular />}
                    className={styles.projectSwitcher}
                    title={projectName}
                  >
                    {projectName}
                  </Button>
                </MenuTrigger>
                <MenuPopover className={styles.projectSwitcherPopover}>
                  <MenuList>
                    {switcherProjects.length === 0 ? (
                      <MenuItem disabled>No other projects</MenuItem>
                    ) : (
                      switcherProjects.map((p) => (
                        <MenuItem key={p.id} onClick={() => handleProjectSwitch(p.id)}>
                          {p.name}
                        </MenuItem>
                      ))
                    )}
                    <MenuItem onClick={() => void navigate('/')}>All projects…</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
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
            {/* Wave 10 B2: blue "+ Capture" button removed. Conjure is now the
                single intake surface. W15: renamed nav + button label from
                "Consult" to "Conjure" so the entry point is visible to users. */}
            <Button
              appearance="primary"
              icon={<ChatHelp20Regular />}
              onClick={() => navigate(id ? `/projects/${id}/consult/new` : '/consult/new')}
              title="Conjure (press c or ?)"
            >
              Conjure
            </Button>
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  )
}
