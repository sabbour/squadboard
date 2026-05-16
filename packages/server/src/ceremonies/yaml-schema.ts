/**
 * yaml-schema.ts — CER-3: Zod runtime validation schema for the canonical
 * .workflow.yaml format (apiVersion: squad.io/v1, kind: Ceremony).
 *
 * Uses discriminated unions on trigger.type so that:
 *  - `event` is required when type=github-event, rejected otherwise
 *  - `schedule` is required when type=cron, rejected otherwise
 *  - .strict() on metadata and spec objects rejects unknown keys
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Trigger sub-schemas (discriminated union on `type`)
// ---------------------------------------------------------------------------

export const triggerTypeSchema = z.enum(['github-event', 'manual', 'cron', 'agent-signal']);

const githubEventTriggerSchema = z
  .object({
    type: z.literal('github-event'),
    event: z.string().min(1, 'event is required for github-event triggers'),
    filters: z
      .object({
        labels: z.array(z.string()).optional(),
        paths: z.array(z.string()).optional(),
      })
      .catchall(z.unknown())
      .optional(),
  })
  .strict();

const manualTriggerSchema = z
  .object({
    type: z.literal('manual'),
  })
  .strict();

const cronTriggerSchema = z
  .object({
    type: z.literal('cron'),
    schedule: z.string().min(1, 'schedule (cron expression) is required for cron triggers'),
  })
  .strict();

const agentSignalTriggerSchema = z
  .object({
    type: z.literal('agent-signal'),
  })
  .strict();

export const triggerSchema = z.discriminatedUnion('type', [
  githubEventTriggerSchema,
  manualTriggerSchema,
  cronTriggerSchema,
  agentSignalTriggerSchema,
]);

// ---------------------------------------------------------------------------
// Step sub-schema (extensible — unknown step keys are allowed via passthrough)
// ---------------------------------------------------------------------------

const baseStepSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
});

export const stepSchema = baseStepSchema.passthrough();

// ---------------------------------------------------------------------------
// Metadata & Spec
// ---------------------------------------------------------------------------

export const metadataSchema = z
  .object({
    name: z.string().min(1, 'metadata.name is required'),
    displayName: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

export const specSchema = z
  .object({
    trigger: triggerSchema,
    steps: z.array(stepSchema),
  })
  .strict();

// ---------------------------------------------------------------------------
// Top-level WorkflowYaml schema
// ---------------------------------------------------------------------------

export const workflowYamlSchema = z
  .object({
    apiVersion: z.literal('squad.io/v1'),
    kind: z.literal('Ceremony'),
    metadata: metadataSchema,
    spec: specSchema,
  })
  .strict();

export type WorkflowYamlInput = z.input<typeof workflowYamlSchema>;
export type WorkflowYamlOutput = z.output<typeof workflowYamlSchema>;
