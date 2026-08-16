/** Deterministic demo questions for the event-scoped builder library. */

import { seedId } from "../../src/lib/ids.ts";
import type { SeedContext, SeedModule } from "./_sql.ts";
import { EVENT_ID } from "./event.ts";
import { SPONSOR_FORM_IDS } from "./sponsors.ts";

const LIBRARY_IDS = {
  audienceFocus: seedId("fldlib", "audience-focus"),
  boothRequirement: seedId("fldlib", "booth-requirement"),
} as const;

function addLibraryQuestion(
  ctx: SeedContext,
  id: string,
  question: {
    key: string;
    label: string;
    help_text: string | null;
    type: string;
    required: 0 | 1;
    config: Record<string, unknown>;
    condition: Record<string, unknown> | null;
  },
): void {
  ctx.add("field_library", {
    id,
    event_id: EVENT_ID,
    ...question,
    config: JSON.stringify(question.config),
    condition: question.condition ? JSON.stringify(question.condition) : null,
    version: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  });
}

function addPlacement(ctx: SeedContext, formId: string, idSuffix: string): void {
  ctx.add("form_fields", {
    id: seedId("fld", `library-${idSuffix}`),
    form_id: formId,
    key: "audience_focus",
    label: "Audience focus",
    help_text: "Who should leave this Session knowing what?",
    type: "short_text",
    required: 0,
    position: 4,
    config: JSON.stringify({ maxLength: 240 }),
    condition: null,
    library_field_id: LIBRARY_IDS.audienceFocus,
    library_field_version: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  });
}

export function run(ctx: SeedContext): void {
  addLibraryQuestion(ctx, LIBRARY_IDS.audienceFocus, {
    key: "audience_focus",
    label: "Audience focus",
    help_text: "Who should leave this Session knowing what?",
    type: "short_text",
    required: 0,
    config: { maxLength: 240 },
    condition: null,
  });
  addLibraryQuestion(ctx, LIBRARY_IDS.boothRequirement, {
    key: "booth_requirement",
    label: "Booth requirement",
    help_text: "Tell the event team what this sponsor needs.",
    type: "single_select",
    required: 0,
    config: { options: ["Power", "Furniture", "None"] },
    condition: { all: [{ fieldKey: "booth_services", op: "answered" }] },
  });
  addPlacement(ctx, SPONSOR_FORM_IDS.companyDetails, "company-details");
  addPlacement(ctx, SPONSOR_FORM_IDS.sessionContent, "session-content");
}

export const seed: SeedModule = { name: "field-library", order: 56, run };
