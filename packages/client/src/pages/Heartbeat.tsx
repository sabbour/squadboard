// TODO(p3-heartbeat): wire to /api/heartbeat once McManus ships the service
import { Title2, Body1, Caption1, Badge, tokens } from '@fluentui/react-components'
import PageHeader from '../components/layout/PageHeader.tsx'

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: `1px solid var(--border)`,
        borderRadius: 10,
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
      }}
    >
      <Title2 as="h3" style={{ margin: 0, fontSize: '15px' }}>
        {title}
      </Title2>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Heartbeat page — scaffolded, wiring deferred until McManus ships the service.
// ---------------------------------------------------------------------------
export default function Heartbeat() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PageHeader
        title="Heartbeat"
        description="Background sweep monitor · service not yet active"
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL }}>

        {/* Section a — Last tick */}
        <SectionCard title="Last tick">
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM }}>
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              Last tick: not yet observed
            </Caption1>
            <Badge appearance="outline" color="informative">
              idle
            </Badge>
          </div>
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            Heartbeat is paused
          </Caption1>
        </SectionCard>

        {/* Section b — Sweeps */}
        <SectionCard title="Sweeps acted on">
          <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
            No sweeps registered yet
          </Body1>
        </SectionCard>

        {/* Section c — Last error */}
        <SectionCard title="Last error">
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>—</Caption1>
        </SectionCard>

      </div>
    </div>
  )
}
