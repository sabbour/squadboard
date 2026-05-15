/**
 * components/ceremony/StepPropertyForm.tsx — Phase 16
 *
 * Per-step property editor used in two places:
 *   1) The Code tab (today's per-step rich form, lifted out of CeremonyEditor)
 *   2) The Visual tab right-rail (when a node is selected)
 *
 * The form mutates a single CeremonyStep via an onChange callback. Editing
 * is field-level; the parent component decides when to re-emit the YAML.
 */

import {
  Caption1,
  Dropdown,
  Input,
  Option,
  Textarea,
} from '@fluentui/react-components'
import type {
  AgentRunStepNode,
  ApproveStepNode,
  CeremonyStep,
  FanOutStepNode,
  HandoffStepNode,
  RouteStepNode,
} from '../../services/ceremony-graph.ts'
import type { Agent } from '../../api/agents.ts'

interface StepPropertyFormProps {
  step: CeremonyStep
  agents: Agent[] | undefined
  onChange: (next: CeremonyStep) => void
  disabled?: boolean
}

function patchExtras<T extends CeremonyStep>(s: T, patch: Partial<T>): T {
  return { ...s, ...patch }
}

export default function StepPropertyForm({ step, agents, onChange, disabled }: StepPropertyFormProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        Label
        <Input
          value={step.label ?? ''}
          onChange={(_, d) => onChange({ ...step, label: d.value })}
          placeholder={`Untitled ${step.kind}`}
          disabled={disabled}
        />
      </label>

      {(step.kind === 'agent_run' || step.kind === 'route') && (
        <RouteOrAgentRunFields
          step={step as AgentRunStepNode | RouteStepNode}
          agents={agents}
          onChange={(next) => onChange(next)}
          disabled={disabled}
        />
      )}

      {step.kind === 'approve' && (
        <ApproveFields
          step={step as ApproveStepNode}
          onChange={(next) => onChange(next)}
          disabled={disabled}
        />
      )}

      {step.kind === 'fan_out' && (
        <FanOutFields
          step={step as FanOutStepNode}
          onChange={(next) => onChange(next)}
          disabled={disabled}
        />
      )}

      {step.kind === 'handoff' && (
        <HandoffFields
          step={step as HandoffStepNode}
          agents={agents}
          onChange={(next) => onChange(next)}
          disabled={disabled}
        />
      )}
    </div>
  )
}

function RouteOrAgentRunFields({
  step,
  agents,
  onChange,
  disabled,
}: {
  step: AgentRunStepNode | RouteStepNode
  agents: Agent[] | undefined
  onChange: (next: AgentRunStepNode | RouteStepNode) => void
  disabled?: boolean
}) {
  return (
    <>
      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        Agent
        <Dropdown
          placeholder="Pick an agent…"
          value={step.agent ?? ''}
          selectedOptions={step.agent ? [step.agent] : []}
          onOptionSelect={(_, d) => onChange(patchExtras(step, { agent: d.optionValue }))}
          disabled={disabled}
        >
          {(agents ?? []).map((a) => (
            <Option key={a.id} value={a.name}>{a.name}</Option>
          ))}
        </Dropdown>
      </label>
      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        Prompt
        <Textarea
          value={step.prompt ?? ''}
          onChange={(_, d) => onChange(patchExtras(step, { prompt: d.value }))}
          placeholder="Prompt template (multi-line OK)"
          disabled={disabled}
          rows={4}
        />
        <Caption1 style={{ color: 'var(--text-muted)' }}>
          Templates: <code>{'${input.foo}'}</code>, <code>{'${event.payload}'}</code>
        </Caption1>
      </label>
      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        Timeout (optional)
        <Input
          value={step.timeout ?? ''}
          onChange={(_, d) => onChange(patchExtras(step, { timeout: d.value || undefined }))}
          placeholder="e.g. 5m, 1h"
          disabled={disabled}
        />
      </label>
    </>
  )
}

function ApproveFields({
  step,
  onChange,
  disabled,
}: {
  step: ApproveStepNode
  onChange: (next: ApproveStepNode) => void
  disabled?: boolean
}) {
  return (
    <>
      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        request_changes_policy
        <Dropdown
          value={step.request_changes_policy ?? 'first'}
          selectedOptions={[step.request_changes_policy ?? 'first']}
          onOptionSelect={(_, d) =>
            onChange(patchExtras(step, { request_changes_policy: d.optionValue as ApproveStepNode['request_changes_policy'] }))
          }
          disabled={disabled}
        >
          <Option value="first">first</Option>
          <Option value="majority">majority</Option>
          <Option value="all">all</Option>
        </Dropdown>
      </label>
      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        Timeout
        <Input
          value={step.timeout ?? ''}
          onChange={(_, d) => onChange(patchExtras(step, { timeout: d.value || undefined }))}
          placeholder="e.g. 24h"
          disabled={disabled}
        />
      </label>
      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        Approvers (comma-separated)
        <Input
          value={(step.approvers ?? []).join(', ')}
          onChange={(_, d) =>
            onChange(
              patchExtras(step, {
                approvers: d.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              }),
            )
          }
          placeholder="lead, qa, security"
          disabled={disabled}
        />
      </label>
    </>
  )
}

function FanOutFields({
  step,
  onChange,
  disabled,
}: {
  step: FanOutStepNode
  onChange: (next: FanOutStepNode) => void
  disabled?: boolean
}) {
  return (
    <>
      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        split_by
        <Dropdown
          value={step.split_by ?? 'agents'}
          selectedOptions={[step.split_by ?? 'agents']}
          onOptionSelect={(_, d) => onChange(patchExtras(step, { split_by: d.optionValue as FanOutStepNode['split_by'] }))}
          disabled={disabled}
        >
          <Option value="agents">agents</Option>
          <Option value="labels">labels</Option>
          <Option value="count">count</Option>
        </Dropdown>
      </label>
      {step.split_by === 'count' && (
        <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          count
          <Input
            type="number"
            value={String(step.count ?? '')}
            onChange={(_, d) => {
              const n = Number(d.value)
              onChange(patchExtras(step, { count: Number.isFinite(n) && n > 0 ? n : undefined }))
            }}
            disabled={disabled}
          />
        </label>
      )}
      {step.split_by === 'agents' && (
        <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          agents (comma-separated)
          <Input
            value={(step.agents ?? []).join(', ')}
            onChange={(_, d) =>
              onChange(
                patchExtras(step, {
                  agents: d.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                }),
              )
            }
            placeholder="reviewer_a, reviewer_b"
            disabled={disabled}
          />
        </label>
      )}
      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        merge_strategy
        <Dropdown
          value={step.merge_strategy ?? 'all'}
          selectedOptions={[step.merge_strategy ?? 'all']}
          onOptionSelect={(_, d) => onChange(patchExtras(step, { merge_strategy: d.optionValue as FanOutStepNode['merge_strategy'] }))}
          disabled={disabled}
        >
          <Option value="all">all</Option>
          <Option value="any">any</Option>
          <Option value="first">first</Option>
        </Dropdown>
      </label>
      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        Spawn mode
        <Dropdown
          value={step.mode ?? 'serial'}
          selectedOptions={[step.mode ?? 'serial']}
          onOptionSelect={(_, d) => onChange(patchExtras(step, { mode: d.optionValue as FanOutStepNode['mode'] }))}
          disabled={disabled}
        >
          <Option value="serial">serial — dispatcher claims children one tick at a time</Option>
          <Option value="parallel">parallel — SDK spawns all children at once</Option>
        </Dropdown>
      </label>
      <Caption1 style={{ color: 'var(--text-muted)' }}>
        Child steps are authored in the YAML preview / Code tab. The visual
        canvas shows each child as a derived node connected by a fan-out edge.
      </Caption1>
    </>
  )
}

function HandoffFields({
  step,
  agents,
  onChange,
  disabled,
}: {
  step: HandoffStepNode
  agents: Agent[] | undefined
  onChange: (next: HandoffStepNode) => void
  disabled?: boolean
}) {
  return (
    <>
      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        to (target agent)
        <Dropdown
          placeholder="Pick an agent…"
          value={step.to ?? ''}
          selectedOptions={step.to ? [step.to] : []}
          onOptionSelect={(_, d) => onChange(patchExtras(step, { to: d.optionValue }))}
          disabled={disabled}
        >
          {(agents ?? []).map((a) => (
            <Option key={a.id} value={a.name}>{a.name}</Option>
          ))}
        </Dropdown>
      </label>
      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        message (optional)
        <Textarea
          value={step.message ?? ''}
          onChange={(_, d) => onChange(patchExtras(step, { message: d.value || undefined }))}
          placeholder="Context for the receiving agent"
          rows={3}
          disabled={disabled}
        />
      </label>
    </>
  )
}
