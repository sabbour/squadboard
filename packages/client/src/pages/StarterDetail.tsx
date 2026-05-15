import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  Title2,
  Title3,
  Subtitle2,
  Body1,
  Caption1,
  Button,
  Tag,
  Spinner,
  MessageBar,
  MessageBarTitle,
  MessageBarBody,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
  Table,
  TableHeader,
  TableHeaderCell,
  TableRow,
  TableCell,
  TableBody,
  Field,
  Input,
  tokens,
} from '@fluentui/react-components'
import {
  ArrowLeft20Regular,
  Open20Regular,
  Sparkle20Regular,
  Person20Regular,
  Flow20Regular,
  Calendar20Regular,
} from '@fluentui/react-icons'
import { useStarter, useUseStarter } from '../api/starters.ts'

export default function StarterDetail() {
  const navigate = useNavigate()
  const { slug } = useParams<{ slug: string }>()
  const { data, isLoading, isError, error } = useStarter(slug)
  const useStarter_ = useUseStarter(slug)
  const [projectName, setProjectName] = useState('')

  if (isLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <Spinner size="medium" label="Loading starter…" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div style={{ padding: '32px', maxWidth: '720px', margin: '0 auto' }}>
        <Button
          appearance="subtle"
          icon={<ArrowLeft20Regular />}
          onClick={() => void navigate('/starters')}
        >
          Back to gallery
        </Button>
        <MessageBar intent="error" style={{ marginTop: '16px' }}>
          <MessageBarBody>
            <MessageBarTitle>Failed to load starter</MessageBarTitle>
            {(error as Error)?.message ?? 'Unknown error'}
          </MessageBarBody>
        </MessageBar>
      </div>
    )
  }

  const { meta, readme, plan, source } = data

  async function handleUse() {
    const result = await useStarter_.mutateAsync({
      projectName: projectName.trim() || undefined,
    })
    void navigate(`/projects/${result.project.id}/dashboard`)
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1080px', margin: '0 auto' }}>
      <Button
        appearance="subtle"
        icon={<ArrowLeft20Regular />}
        onClick={() => void navigate('/starters')}
        style={{ marginBottom: '12px' }}
      >
        Back to gallery
      </Button>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap',
          marginBottom: '8px',
        }}
      >
        <div style={{ flex: 1, minWidth: '320px' }}>
          <Title2 as="h1">{meta.title}</Title2>
          <Caption1
            style={{
              color: tokens.colorNeutralForeground3,
              fontFamily: 'monospace',
              display: 'block',
              marginTop: '4px',
            }}
          >
            {meta.slug}
          </Caption1>
          {meta.blurb && (
            <Body1 style={{ display: 'block', marginTop: '8px' }}>{meta.blurb}</Body1>
          )}
          <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
            {meta.tags.map((t) => (
              <Tag key={t} size="small" appearance="outline">
                {t}
              </Tag>
            ))}
          </div>
        </div>

        <a
          href={meta.htmlUrl}
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: 'none' }}
        >
          <Button appearance="outline" icon={<Open20Regular />}>
            View on GitHub
          </Button>
        </a>
      </div>

      {/* Stat strip */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          margin: '24px 0',
          flexWrap: 'wrap',
        }}
      >
        <StatTile icon={<Person20Regular />} label="Agents" value={plan.agents.length} />
        <StatTile icon={<Flow20Regular />} label="Routing rules" value={plan.routingRules.length} />
        <StatTile
          icon={<Calendar20Regular />}
          label="Ceremonies"
          value={plan.ceremonies.length}
        />
        {plan.defaultModel && (
          <StatTile icon={<Sparkle20Regular />} label="Default model" value={plan.defaultModel} />
        )}
      </div>

      {/* Use this starter form */}
      <section
        style={{
          padding: '20px',
          border: `1px solid ${tokens.colorNeutralStroke2}`,
          borderRadius: '8px',
          marginBottom: '24px',
          background: tokens.colorNeutralBackground2,
        }}
      >
        <Subtitle2 as="h2">Use this starter</Subtitle2>
        <Body1
          style={{
            display: 'block',
            color: tokens.colorNeutralForeground3,
            marginTop: '4px',
          }}
        >
          Squadboard creates a new project under{' '}
          <code>~/.squadboard/projects/</code> with the agents, charters,
          routing rules, and ceremonies already wired up.
        </Body1>
        <div style={{ display: 'flex', gap: '12px', marginTop: '14px', alignItems: 'flex-end' }}>
          <Field label="Project name" hint="Leave blank to use the starter title" style={{ flex: 1, minWidth: '280px' }}>
            <Input
              placeholder={meta.title}
              value={projectName}
              onChange={(_, d) => setProjectName(d.value)}
            />
          </Field>
          <Button
            appearance="primary"
            icon={<Sparkle20Regular />}
            onClick={() => {
              void handleUse()
            }}
            disabled={useStarter_.isPending}
          >
            {useStarter_.isPending ? 'Creating…' : 'Use this starter'}
          </Button>
        </div>
        {useStarter_.isError && (
          <MessageBar intent="error" style={{ marginTop: '12px' }}>
            <MessageBarBody>
              <MessageBarTitle>Failed to create project</MessageBarTitle>
              {(useStarter_.error as Error)?.message ?? 'Unknown error'}
            </MessageBarBody>
          </MessageBar>
        )}
        {useStarter_.isSuccess && (
          <MessageBar intent="success" style={{ marginTop: '12px' }}>
            <MessageBarBody>
              <MessageBarTitle>Project created</MessageBarTitle>
              {useStarter_.data?.result.agentsInserted} agents,{' '}
              {useStarter_.data?.result.routingRulesInserted} routing rules,{' '}
              {useStarter_.data?.result.filesWritten} files written.
            </MessageBarBody>
          </MessageBar>
        )}
      </section>

      {/* What's included */}
      <Title3 as="h2" style={{ marginTop: '24px', marginBottom: '12px' }}>
        What's included
      </Title3>

      <Accordion multiple defaultOpenItems={['agents']} collapsible>
        <AccordionItem value="agents">
          <AccordionHeader expandIconPosition="end">
            <span style={{ fontWeight: 600 }}>
              Agents <Caption1 style={{ marginLeft: 8, color: tokens.colorNeutralForeground3 }}>· {plan.agents.length}</Caption1>
            </span>
          </AccordionHeader>
          <AccordionPanel>
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>Model</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.agents.map((a) => (
                  <TableRow key={a.name}>
                    <TableCell>
                      <code>{a.name}</code>
                    </TableCell>
                    <TableCell>{a.role}</TableCell>
                    <TableCell>
                      <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                        {a.model || plan.defaultModel || '—'}
                      </Caption1>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionPanel>
        </AccordionItem>

        {plan.routingRules.length > 0 && (
          <AccordionItem value="routing">
            <AccordionHeader expandIconPosition="end">
              <span style={{ fontWeight: 600 }}>
                Routing <Caption1 style={{ marginLeft: 8, color: tokens.colorNeutralForeground3 }}>· {plan.routingRules.length} rules</Caption1>
              </span>
            </AccordionHeader>
            <AccordionPanel>
              <Table size="small">
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Priority</TableHeaderCell>
                    <TableHeaderCell>Match</TableHeaderCell>
                    <TableHeaderCell>Pattern</TableHeaderCell>
                    <TableHeaderCell>Assigned to</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.routingRules
                    .slice()
                    .sort((a, b) => a.priority - b.priority)
                    .map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{r.priority}</TableCell>
                        <TableCell>{r.matchType}</TableCell>
                        <TableCell>
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '4px',
                              maxWidth: '380px',
                            }}
                          >
                            {r.pattern.split('|').map((tok, j) => (
                              <span
                                key={j}
                                style={{
                                  background: tokens.colorNeutralBackground3,
                                  color: tokens.colorNeutralForeground2,
                                  fontFamily: 'monospace',
                                  fontSize: '11px',
                                  borderRadius: '4px',
                                  padding: '1px 6px',
                                  lineHeight: 1.4,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {tok}
                              </span>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <code>@{r.agentName}</code>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </AccordionPanel>
          </AccordionItem>
        )}

        {plan.ceremonies.length > 0 && (
          <AccordionItem value="ceremonies">
            <AccordionHeader expandIconPosition="end">
              <span style={{ fontWeight: 600 }}>
                Ceremonies <Caption1 style={{ marginLeft: 8, color: tokens.colorNeutralForeground3 }}>· {plan.ceremonies.length}</Caption1>
              </span>
            </AccordionHeader>
            <AccordionPanel>
              <ul style={{ paddingLeft: 20, margin: 0 }}>
                {plan.ceremonies.map((c) => (
                  <li key={c.name}>
                    <code>{c.name}</code>{' '}
                    <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                      → {c.filePath}
                    </Caption1>
                  </li>
                ))}
              </ul>
            </AccordionPanel>
          </AccordionItem>
        )}

        {plan.warnings.length > 0 && (
          <AccordionItem value="warnings">
            <AccordionHeader expandIconPosition="end">
              <span style={{ fontWeight: 600, color: tokens.colorPaletteYellowForeground1 }}>
                Mapper warnings <Caption1 style={{ marginLeft: 8, color: tokens.colorNeutralForeground3 }}>· {plan.warnings.length}</Caption1>
              </span>
            </AccordionHeader>
            <AccordionPanel>
              <ul style={{ paddingLeft: 20, margin: 0 }}>
                {plan.warnings.map((w, i) => (
                  <li key={i}>
                    <Caption1>{w}</Caption1>
                  </li>
                ))}
              </ul>
            </AccordionPanel>
          </AccordionItem>
        )}
      </Accordion>

      {/* README */}
      {readme && (
        <>
          <Title3 as="h2" style={{ marginTop: '24px', marginBottom: '12px' }}>
            README
          </Title3>
          <pre
            style={{
              background: tokens.colorNeutralBackground3,
              padding: '16px',
              borderRadius: '8px',
              maxHeight: '480px',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: '13px',
              lineHeight: 1.5,
            }}
          >
            {readme}
          </pre>
        </>
      )}

      {/* Source */}
      {source && (
        <Accordion collapsible style={{ marginTop: '24px' }}>
          <AccordionItem value="source">
            <AccordionHeader expandIconPosition="end">
              <span style={{ fontWeight: 600 }}>squad.config.ts source</span>
            </AccordionHeader>
            <AccordionPanel>
              <pre
                style={{
                  background: tokens.colorNeutralBackground3,
                  padding: '12px',
                  borderRadius: '8px',
                  maxHeight: '520px',
                  overflow: 'auto',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                }}
              >
                {source}
              </pre>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  )
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
}) {
  return (
    <div
      style={{
        padding: '12px 16px',
        background: tokens.colorNeutralBackground2,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: '8px',
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        minWidth: '160px',
      }}
    >
      <span style={{ color: tokens.colorBrandForeground1 }}>{icon}</span>
      <div>
        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
          {label}
        </Caption1>
        <Body1 style={{ fontWeight: 600 }}>{value}</Body1>
      </div>
    </div>
  )
}
