import { Outlet, NavLink, useParams } from 'react-router'
import squadboardLogo from '../assets/squadboard-horizontal.svg'
import {
  Home24Regular,
  Grid24Regular,
  ClipboardTaskListLtr24Regular,
  Bot24Regular,
  ArrowSync24Regular,
  Money24Regular,
  Settings24Regular,
} from '@fluentui/react-icons'

const NAV_ITEMS: { label: string; to: string; icon: React.ReactNode; enabled: boolean }[] = [
  { label: 'Dashboard', to: 'dashboard', icon: <Grid24Regular />, enabled: true },
  { label: 'Board', to: 'board', icon: <ClipboardTaskListLtr24Regular />, enabled: true },
  { label: 'Agents', to: 'agents', icon: <Bot24Regular />, enabled: true },
  { label: 'Workflows', to: 'workflows', icon: <ArrowSync24Regular />, enabled: true },
  { label: 'Costs', to: 'costs', icon: <Money24Regular />, enabled: true },
]

const NAV_BOTTOM_ITEMS: { label: string; to: string; icon: React.ReactNode; enabled: boolean }[] = [
  { label: 'Settings', to: 'settings', icon: <Settings24Regular />, enabled: true },
]

export default function Layout() {
  const { id } = useParams<{ id?: string }>()

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Sidebar */}
      <aside
        style={{
          width: '200px',
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Logo / wordmark */}
        <div
          style={{
            padding: '16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <img src={squadboardLogo} alt="Squadboard" style={{ height: '32px', display: 'block' }} />
        </div>

        {/* Top nav — only show project nav when inside a project */}
        <nav style={{ flex: 1, padding: '8px 0', display: 'flex', flexDirection: 'column' }}>
          <NavLink
            to="/"
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '7px 16px',
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: isActive ? 500 : 400,
              fontSize: '13px',
              textDecoration: 'none',
              borderRadius: 0,
            })}
          >
            <Home24Regular /> Projects
          </NavLink>

          {id && (
            <>
              <div
                style={{
                  padding: '12px 16px 4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-muted)',
                }}
              >
                Project
              </div>

              {NAV_ITEMS.map((item) => {
                const to = `/projects/${id}/${item.to}`
                if (!item.enabled) {
                  return (
                    <span
                      key={item.label}
                      title="Coming soon"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '7px 16px',
                        color: 'var(--border)',
                        fontSize: '13px',
                        cursor: 'not-allowed',
                      }}
                    >
                      {item.label}
                    </span>
                  )
                }

                return (
                  <NavLink
                    key={item.label}
                    to={to}
                    style={({ isActive }) => ({
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '7px 16px',
                      color: isActive ? 'var(--text)' : 'var(--text-muted)',
                      fontWeight: isActive ? 500 : 400,
                      fontSize: '13px',
                      textDecoration: 'none',
                      background: isActive ? 'rgba(9, 105, 218, 0.08)' : 'transparent',
                      borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    })}
                  >
                    {item.icon && <span>{item.icon}</span>}
                    {item.label}
                  </NavLink>
                )
              })}
            </>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Bottom nav — Settings (only when inside a project) */}
          {id && (
            <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              {NAV_BOTTOM_ITEMS.map((item) => {
                const to = `/projects/${id}/${item.to}`
                return (
                  <NavLink
                    key={item.label}
                    to={to}
                    style={({ isActive }) => ({
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '7px 16px',
                      color: isActive ? 'var(--text)' : 'var(--text-muted)',
                      fontWeight: isActive ? 500 : 400,
                      fontSize: '13px',
                      textDecoration: 'none',
                      background: isActive ? 'rgba(9, 105, 218, 0.08)' : 'transparent',
                      borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    })}
                  >
                    {item.icon && <span>{item.icon}</span>}
                    {item.label}
                  </NavLink>
                )
              })}
            </div>
          )}
        </nav>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Outlet />
      </main>
    </div>
  )
}
