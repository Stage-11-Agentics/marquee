import { z } from "@hono/zod-openapi";

export const kindFeedbackResponseSchema = z.object({
  paragraph: z.string().nullable(),
  notice: z.string().nullable(),
  provenance: z.string().nullable(),
}).openapi("KindFeedbackDraftResponse");

export type KindFeedbackDraftResponse = z.infer<typeof kindFeedbackResponseSchema>;
