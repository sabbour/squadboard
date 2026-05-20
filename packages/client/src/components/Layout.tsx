import React, { Suspense, useState, useEffect, useMemo } from 'react'
import { Outlet, useParams, useNavigate, useLocation } from 'react-router'
import { apiFetch } from '../api/client.ts'
import { useProjects } from '../api/projects.ts'
import { useInboxItems } from '../api/inbox.ts'
import squadboardLogo from '../assets/squadboard-horizontal.png'
import {
  NavDrawer,
  NavDrawerBody,
  NavItem,
  NavSectionHeader,
  Button,
  Combobox,
  CounterBadge,
  Option,
  OptionGroup,
  Tooltip,
  makeStyles,
  mergeClasses,
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
  ChatHelp20Regular,
  Eye24Regular,
  Heart24Regular,
  HeartPulse24Regular,
  DocumentBulletList24Regular,
  ChevronDoubleLeftRegular,
  ChevronDoubleRightRegular,
  AppsListDetail24Regular,
} from '@fluentui/react-icons'
import type { OnNavItemSelectData } from '@fluentui/react-components'
import { ConjureProvider, useConjure } from '../context/ConjureContext.tsx'
import { PageLoading } from './loading/index.tsx'
import ConjureModal from './conjure/ConjureModal.tsx'

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
    transition: 'width 200ms ease',
    '& nav': {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    },
  },
  navDrawerCollapsed: {
    width: '56px',
    minWidth: '56px',
    overflow: 'hidden',
  },
  navCollapseToggle: {
    display: 'flex',
    justifyContent: 'center',
    paddingTop: tokens.spacingVerticalXS,
    paddingBottom: tokens.spacingVerticalXS,
  },
  navCollapseToggleExpanded: {
    justifyContent: 'flex-end',
    paddingInlineEnd: tokens.spacingHorizontalS,
  },
  navLabelHidden: {
    display: 'none',
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
  // O6: Fluent2 Combobox project switcher — min 320px, max 480px, no wrap.
  projectCombobox: {
    minWidth: '320px',
    maxWidth: '480px',
    fontWeight: tokens.fontWeightSemibold,
    // Prevent the input from stretching the top bar on narrow viewports.
    flexShrink: 1,
    '& input': {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  },
})

// ── Recent-projects persistence (localStorage, last 5 IDs) ──────────────────
const RECENT_KEY = 'squadboard:recent-project-ids'
const MAX_RECENT = 5

function getRecentIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function pushRecentId(id: string): string[] {
  const next = [id, ...getRecentIds().filter((x) => x !== id)].slice(0, MAX_RECENT)
  localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  return next
}

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
      { label: 'Settings', segment: 'settings', icon: <Settings24Regular /> },
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
  return (
    <ConjureProvider>
      <LayoutInner />
    </ConjureProvider>
  )
}

function LayoutInner() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const styles = useStyles()
  const { openConjure, isOpen: conjureOpen, payload: conjurePayload, closeConjure } = useConjure()

  const [projectName, setProjectName] = useState<string | null>(null)
  const projectsQuery = useProjects()
  const projects = projectsQuery.data

  const inboxQuery = useInboxItems({ projectId: id })
  const unreadInboxCount = (inboxQuery.data ?? []).filter(
    (item) => item.status === 'captured' || item.status === 'formulated'
  ).length

  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('squadboard.nav.collapsed') === 'true')

  function toggleNav() {
    setNavCollapsed(prev => {
      const next = !prev
      localStorage.setItem('squadboard.nav.collapsed', String(next))
      return next
    })
  }

  // O6: Combobox search text. When it matches the current project name (or is
  // empty), no filtering is applied. When the user types something different,
  // the list filters to matching project names.
  const [comboValue, setComboValue] = useState<string>('')

  // O6: Recent project IDs persisted to localStorage (up to MAX_RECENT).
  const [recentIds, setRecentIds] = useState<string[]>(() => getRecentIds())

  // Sync combobox display value whenever the active project name changes.
  useEffect(() => {
    setComboValue(projectName ?? '')
  }, [projectName])

  // All projects sorted alphabetically (for the main list).
  const allProjectsSorted = useMemo(() => {
    if (!projects) return []
    return [...projects].sort((a, b) => a.name.localeCompare(b.name))
  }, [projects])

  // Filtered by combobox search (only when the user has typed something other
  // than the exact current project name — avoids filtering the full list away
  // on initial open).
  const filteredProjects = useMemo(() => {
    const q = comboValue.trim().toLowerCase()
    if (!q || q === (projectName ?? '').toLowerCase()) return allProjectsSorted
    return allProjectsSorted.filter((p) => p.name.toLowerCase().includes(q))
  }, [comboValue, allProjectsSorted, projectName])

  // Recent projects shown at the top (max 5, excluding current project, in
  // recent-first order, and respecting current search filter).
  const recentProjects = useMemo(() => {
    if (!projects) return []
    const q = comboValue.trim().toLowerCase()
    const isFiltering = q && q !== (projectName ?? '').toLowerCase()
    return recentIds
      .filter((rid) => rid !== id)
      .map((rid) => projects.find((p) => p.id === rid))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .filter((p) => !isFiltering || p.name.toLowerCase().includes(q))
  }, [recentIds, projects, id, comboValue, projectName])

  // The category segment we want to preserve when switching projects.
  const currentCategory = useMemo(
    () => extractProjectCategory(location.pathname, id),
    [location.pathname, id],
  )

  function handleProjectSwitch(newProjectId: string) {
    const next = pushRecentId(newProjectId)
    setRecentIds(next)
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

  // Wave 22: 'c', '?' and Ctrl/Cmd+K all open ConjureModal (NOT navigate to consult/new).
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
      // Ctrl/Cmd+K → Conjure modal (works even in text fields to match VS Code palette UX)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === 'k') {
        e.preventDefault()
        openConjure({ projectId: id, projectName })
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      if (e.key === 'c' || e.key === '?') {
        e.preventDefault()
        openConjure({ projectId: id, projectName })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, navigate, openConjure, projectName])

  function getSelectedValue(): string {
    if (location.pathname === '/' || location.pathname === '') return 'projects'
    if (location.pathname.startsWith('/now')) return 'now'
    if (location.pathname.startsWith('/apps')) return 'apps'
    if (location.pathname.startsWith('/diagnostics')) return 'diagnostics'
    if (location.pathname.startsWith('/heartbeat')) return 'heartbeat'
    if (id) {
      // Project-scoped heartbeat: /projects/:id/heartbeat
      if (location.pathname.includes('/heartbeat')) return 'heartbeat'
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
    } else if (value === 'apps') {
      void navigate('/apps')
    } else if (value === 'now') {
      void navigate('/now')
    } else if (value === 'diagnostics') {
      void navigate(id ? `/projects/${id}/diagnostics` : '/diagnostics')
    } else if (value === 'heartbeat') {
      // W22 directive: preserve project scope when navigating to Heartbeat
      void navigate(id ? `/projects/${id}/heartbeat` : '/heartbeat')
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
        className={mergeClasses(styles.navDrawer, navCollapsed ? styles.navDrawerCollapsed : undefined)}
      >
        {/* Logo / wordmark — hidden when collapsed to avoid overflow */}
        {!navCollapsed && (
          <div className={styles.sidebarLogo}>
            <img src={squadboardLogo} alt="Squadboard" style={{ height: '44px', display: 'block' }} />
          </div>
        )}

        <NavDrawerBody>
          {/* Collapse / expand toggle */}
          <div className={mergeClasses(styles.navCollapseToggle, !navCollapsed && styles.navCollapseToggleExpanded)}>
            <Button
              appearance="subtle"
              icon={navCollapsed ? <ChevronDoubleRightRegular /> : <ChevronDoubleLeftRegular />}
              onClick={toggleNav}
              title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            />
          </div>

          {navCollapsed ? (
            <Tooltip content="Projects" relationship="label" positioning="after" hideDelay={0}>
              <NavItem icon={<Home24Regular />} value="projects">
                <span className={styles.navLabelHidden}>Projects</span>
              </NavItem>
            </Tooltip>
          ) : (
            <NavItem icon={<Home24Regular />} value="projects">Projects</NavItem>
          )}

          {navCollapsed ? (
            <Tooltip content="Now" relationship="label" positioning="after" hideDelay={0}>
              <NavItem icon={<Eye24Regular />} value="now">
                <span className={styles.navLabelHidden}>Now</span>
              </NavItem>
            </Tooltip>
          ) : (
            <NavItem icon={<Eye24Regular />} value="now">Now</NavItem>
          )}

          {navCollapsed ? (
            <Tooltip content="Apps" relationship="label" positioning="after" hideDelay={0}>
              <NavItem icon={<AppsListDetail24Regular />} value="apps">
                <span className={styles.navLabelHidden}>Apps</span>
              </NavItem>
            </Tooltip>
          ) : (
            <NavItem icon={<AppsListDetail24Regular />} value="apps">Apps</NavItem>
          )}

          {id && (
            <>
              {PROJECT_NAV_GROUPS.map((group) => (
                <div key={group.heading}>
                  {!navCollapsed && <NavSectionHeader>{group.heading}</NavSectionHeader>}
                  {group.items.map((item) => (
                    navCollapsed ? (
                      <Tooltip key={item.segment} content={item.label} relationship="label" positioning="after" hideDelay={0}>
                        <NavItem icon={item.icon} value={item.segment}>
                          <span className={styles.navLabelHidden}>{item.label}</span>
                        </NavItem>
                      </Tooltip>
                    ) : (
                      <NavItem key={item.segment} icon={item.icon} value={item.segment}>
                        {item.label}
                      </NavItem>
                    )
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
          {!navCollapsed && <NavSectionHeader>SYSTEM</NavSectionHeader>}

          {navCollapsed ? (
            <Tooltip content="Diagnostics" relationship="label" positioning="after" hideDelay={0}>
              <NavItem icon={<HeartPulse24Regular />} value="diagnostics">
                <span className={styles.navLabelHidden}>Diagnostics</span>
              </NavItem>
            </Tooltip>
          ) : (
            <NavItem icon={<HeartPulse24Regular />} value="diagnostics">Diagnostics</NavItem>
          )}

          {navCollapsed ? (
            <Tooltip content="Heartbeat" relationship="label" positioning="after" hideDelay={0}>
              <NavItem icon={<Heart24Regular />} value="heartbeat">
                <span className={styles.navLabelHidden}>Heartbeat</span>
              </NavItem>
            </Tooltip>
          ) : (
            <NavItem icon={<Heart24Regular />} value="heartbeat">Heartbeat</NavItem>
          )}
        </NavDrawerBody>

      </NavDrawer>

      {/* Main content */}
      <main className={styles.main}>
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            {/* O6: Fluent2 Combobox project switcher — searchable, min 320px,
                max 480px. Tooltip surfaces the full project name on overflow.
                Recent projects (last 5) appear at the top of the dropdown. */}
            {id && projects && (
              <Tooltip
                content={projectName ?? ''}
                relationship="label"
                positioning="below-start"
                hideDelay={0}
              >
                <Combobox
                  className={styles.projectCombobox}
                  value={comboValue}
                  selectedOptions={id ? [id] : []}
                  placeholder="Select project…"
                  onInput={(e) => setComboValue(e.currentTarget.value)}
                  onOptionSelect={(_, data) => {
                    if (!data.optionValue) return
                    const selected = projects.find((p) => p.id === data.optionValue)
                    if (selected) {
                      setComboValue(selected.name)
                      handleProjectSwitch(data.optionValue)
                    }
                  }}
                  onBlur={() => {
                    // Restore the current project name if the user typed but
                    // didn't pick anything.
                    setComboValue(projectName ?? '')
                  }}
                >
                  {recentProjects.length > 0 && (
                    <OptionGroup label="Recent">
                      {recentProjects.map((p) => (
                        <Option key={p.id} value={p.id} text={p.name}>
                          {p.name}
                        </Option>
                      ))}
                    </OptionGroup>
                  )}
                  <OptionGroup label={recentProjects.length > 0 ? 'All Projects' : undefined}>
                    {filteredProjects.map((p) => (
                      <Option key={p.id} value={p.id} text={p.name}>
                        {p.name}
                      </Option>
                    ))}
                    {filteredProjects.length === 0 && (
                      <Option value="" disabled text="">
                        No projects match "{comboValue}"
                      </Option>
                    )}
                  </OptionGroup>
                </Combobox>
              </Tooltip>
            )}
          </div>
          <div className={styles.topBarRight}>
            <Button
              appearance="subtle"
              icon={<DocumentBulletList24Regular />}
              onClick={() => window.open('https://sabbour.me/squadboard/docs', '_blank', 'noopener,noreferrer')}
              title="Open Squadboard docs"
            >
              Docs
            </Button>
            <Button
              appearance="subtle"
              icon={
                <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                  <Mail20Regular />
                  {unreadInboxCount > 0 && (
                    <CounterBadge
                      count={unreadInboxCount}
                      size="small"
                      style={{ position: 'absolute', top: -6, right: -8 }}
                    />
                  )}
                </span>
              }
              onClick={() => navigate(id ? `/projects/${id}/inbox` : '/inbox')}
              title="Inbox"
            >
              Inbox
            </Button>
            <Button
              appearance="primary"
              icon={<ChatHelp20Regular />}
              onClick={() => navigate(id ? `/projects/${id}/consult/new` : '/consult/new')}
              title="Start a Consult"
            >
              Consult
            </Button>
          </div>
        </div>
        <Suspense fallback={<PageLoading label="Loading page…" />}>
          <Outlet />
        </Suspense>

        {/* Hoisted ConjureModal — single instance, opened from any entry point */}
        <ConjureModal
          isOpen={conjureOpen}
          onClose={closeConjure}
          hint={conjurePayload.hint}
          initialProse={conjurePayload.initialProse}
          projectId={conjurePayload.projectId ?? id}
          projectName={conjurePayload.projectName ?? projectName}
        />
      </main>
    </div>
  )
}
