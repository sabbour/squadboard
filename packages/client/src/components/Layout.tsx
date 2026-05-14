import { Outlet, NavLink, useParams } from 'react-router'

const NAV_ITEMS = [
  { label: 'Board', to: 'board', enabled: true },
  { label: 'Agents', to: 'agents', enabled: true },
  { label: 'Workflows', to: 'workflows', enabled: false },
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
          <span style={{ fontSize: '18px' }}>⬡</span>
          <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '-0.01em' }}>
            Squadboard
          </span>
        </div>

        {/* Top nav — only show project nav when inside a project */}
        <nav style={{ flex: 1, padding: '8px 0' }}>
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
            <span>🏠</span> Projects
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
                      background: isActive ? 'rgba(56, 139, 253, 0.1)' : 'transparent',
                      borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    })}
                  >
                    {item.label}
                  </NavLink>
                )
              })}
            </>
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
