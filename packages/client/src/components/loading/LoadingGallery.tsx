/**
 * LoadingGallery — DEV-only reference page at /__loading-gallery.
 *
 * Renders all three Squadboard loading components side-by-side with all label
 * variants so future agents can quickly see what each component looks like
 * before choosing one. Also documents the RouteProgressBar behaviour.
 *
 * Mount: see App.tsx — route is only registered when import.meta.env.DEV.
 */

import { tokens, Divider, Text, Badge } from '@fluentui/react-components'
import PageHeader from '../layout/PageHeader.tsx'
import { PageLoading } from './PageLoading.tsx'
import { SectionLoading } from './SectionLoading.tsx'
import { InlineLoading } from './InlineLoading.tsx'
import { ActionLoading } from './ActionLoading.tsx'
import RouteProgressBar from '../RouteProgressBar.tsx'

function GallerySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <Text weight="semibold" size={400}>{title}</Text>
        <Badge appearance="outline" color="informative" size="small">component</Badge>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>
        {children}
      </div>
    </section>
  )
}

function Variant({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: tokens.borderRadiusMedium,
        padding: '16px',
        minWidth: '220px',
        background: tokens.colorNeutralBackground2,
      }}
    >
      <Text size={200} style={{ color: tokens.colorNeutralForeground3, fontFamily: 'monospace' }}>
        {label}
      </Text>
      {children}
    </div>
  )
}

export default function LoadingGallery() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: tokens.colorNeutralBackground1 }}>
      <PageHeader
        title="Loading patterns gallery"
        description="DEV-only reference page · /__loading-gallery · All loading variants rendered in one place."
      />

      <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>

        {/* RouteProgressBar */}
        <GallerySection title="RouteProgressBar">
          <Variant label="<RouteProgressBar /> — auto-mounted in App.tsx">
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              A thin brand-coloured bar animates at the top of the viewport on every React Router
              navigation (350 ms cycle). Controlled by the <code>routeProgressBar</code> user pref.
              It is already active on this page — navigate away and back to see it.
            </Text>
            <RouteProgressBar />
          </Variant>
        </GallerySection>

        <Divider style={{ marginBottom: '32px' }} />

        {/* PageLoading */}
        <GallerySection title="PageLoading">
          <Variant label='<PageLoading />'>
            <div style={{ height: '160px', position: 'relative', overflow: 'hidden' }}>
              <PageLoading />
            </div>
          </Variant>
          <Variant label='<PageLoading label="Loading costs…" />'>
            <div style={{ height: '160px', position: 'relative', overflow: 'hidden' }}>
              <PageLoading label="Loading costs…" />
            </div>
          </Variant>
          <Variant label='<PageLoading label="…" size="large" />'>
            <div style={{ height: '160px', position: 'relative', overflow: 'hidden' }}>
              <PageLoading label="Loading ceremonies…" size="large" />
            </div>
          </Variant>
        </GallerySection>

        <Divider style={{ marginBottom: '32px' }} />

        {/* SectionLoading */}
        <GallerySection title="SectionLoading">
          <Variant label='<SectionLoading />'>
            <SectionLoading />
          </Variant>
          <Variant label='<SectionLoading label="Loading members…" />'>
            <SectionLoading label="Loading members…" />
          </Variant>
          <Variant label='<SectionLoading label="…" size="medium" />'>
            <SectionLoading label="Loading agents…" size="medium" />
          </Variant>
        </GallerySection>

        <Divider style={{ marginBottom: '32px' }} />

        {/* InlineLoading */}
        <GallerySection title="InlineLoading">
          <Variant label='<InlineLoading />'>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <InlineLoading /> <Text size={200}>Next to text</Text>
            </div>
          </Variant>
          <Variant label='<InlineLoading label="Saving…" />'>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <InlineLoading label="Saving…" /> <Text size={200}>Saving…</Text>
            </div>
          </Variant>
          <Variant label='<InlineLoading size="small" />'>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <InlineLoading size="small" /> <Text size={200}>Small variant</Text>
            </div>
          </Variant>
        </GallerySection>

        <Divider style={{ marginBottom: '32px' }} />

        {/* ActionLoading */}
        <GallerySection title="ActionLoading">
          <Variant label='<ActionLoading /> — inside Button icon prop'>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ActionLoading /> <Text size={200}>Button-icon slot (size="tiny")</Text>
            </div>
          </Variant>
          <Variant label='<ActionLoading label="Saving…" />'>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ActionLoading label="Saving…" /> <Text size={200}>With accessible label</Text>
            </div>
          </Variant>
        </GallerySection>

      </div>
    </div>
  )
}
