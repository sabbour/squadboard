export default function EmptyBoard() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: '400px',
        gap: '16px',
        textAlign: 'center',
        padding: '40px',
      }}
    >
      <div
        style={{
          fontSize: '48px',
          lineHeight: 1,
          marginBottom: '8px',
          opacity: 0.5,
        }}
      >
        🗂️
      </div>

      <h2
        style={{
          fontSize: '18px',
          fontWeight: 600,
          color: 'var(--text)',
        }}
      >
        No issues yet — create one to get started.
      </h2>

      <p
        style={{
          color: 'var(--text-muted)',
          maxWidth: '360px',
          lineHeight: 1.6,
        }}
      >
        Drag cards between columns, create issues, and assign agents.
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginTop: '8px',
          padding: '8px 16px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          fontSize: '13px',
          color: 'var(--text-muted)',
        }}
      >
        <span style={{ color: 'var(--success)' }}>●</span>
        Backend connected · .squad/ directory registered
      </div>
    </div>
  )
}
