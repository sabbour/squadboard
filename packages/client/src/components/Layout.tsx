import { Outlet, useParams, useNavigate, useLocation } from 'react-router'
import squadboardLogo from '../assets/squadboard-horizontal.svg'
import {
  NavDrawer,
  NavDrawerBody,
  NavDrawerFooter,
  NavItem,
  NavSectionHeader,
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
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  navDrawer: {
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    '& nav': {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    },
  },
})

const PROJECT_NAV_ITEMS = [
  { label: 'Dashboard', segment: 'dashboard', icon: <Grid24Regular /> },
  { label: 'Board', segment: 'board', icon: <ClipboardTaskListLtr24Regular /> },
  { label: 'Agents', segment: 'agents', icon: <Bot24Regular /> },
  { label: 'Workflows', segment: 'workflows', icon: <ArrowSync24Regular /> },
  { label: 'Costs', segment: 'costs', icon: <Money24Regular /> },
]

export default function Layout() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const styles = useStyles()

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
          <img src={squadboardLogo} alt="Squadboard" style={{ height: '32px', display: 'block' }} />
        </div>

        <NavDrawerBody>
          <NavItem icon={<Home24Regular />} value="projects">
            Projects
          </NavItem>

          {id && (
            <>
              <NavSectionHeader>PROJECT</NavSectionHeader>
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
        <Outlet />
      </main>
    </div>
  )
}
