import { z } from "@hono/zod-openapi";

import type { DecisionPlan } from "../jobs/cascade/decision-plan";

export const decisionPlanActionSchema = z.enum(["accept", "reject", "waitlist", "withdraw", "notify"]);

export const decisionPlanRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  reason: z.string(),
  demo_suppressed: z.boolean(),
}).openapi("DecisionPlanRecord");

export const decisionPlanRowSchema = z.object({
  disposition: z.enum(["will_send", "already_notified", "no_valid_address", "cannot_move"]),
  count: z.number().int().nonnegative(),
  records: z.array(decisionPlanRecordSchema),
}).openapi("DecisionPlanRow");

export const decisionPlanTemplateSchema = z.object({
  key: z.string(),
  subject: z.string(),
  body_md: z.string(),
  enabled: z.boolean(),
}).openapi("DecisionPlanTemplate");

export const decisionPlanPreviewSchema = z.object({
  to_email: z.string(),
  subject: z.string(),
  text: z.string(),
  html: z.string(),
}).nullable().openapi("DecisionPlanPreview");

export const decisionPlanZeroEffectSchema = z.object({
  code: z.literal("zero_effect"),
  reason: z.string(),
}).nullable();

export const decisionPlanResponseSchema = z.object({
  action: decisionPlanActionSchema,
  feedback_md: z.string().nullable(),
  mail_mode: z.enum(["rendered", "none"]),
  template: decisionPlanTemplateSchema,
  demo_suppressed: z.number().int().nonnegative(),
  rows: z.array(decisionPlanRowSchema).length(4),
  recipient_preview: decisionPlanPreviewSchema,
  plan_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  etag: z.string(),
  queue_revision: z.number().int().nonnegative(),
  selected: z.number().int().nonnegative(),
  kind_feedback_enabled: z.boolean(),
  zero_effect: decisionPlanZeroEffectSchema,
}).openapi("DecisionPlanResponse");

/** Keep the wire schema and client-facing type aligned with the shared planner invariants. */
export type DecisionPlanResponse = DecisionPlan & {
  recipient_preview: {
    to_email: string;
    subject: string;
    text: string;
    html: string;
  } | null;
  plan_fingerprint: string;
  etag: string;
  queue_revision: number;
  selected: number;
  kind_feedback_enabled: boolean;
};
