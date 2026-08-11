import {
  DEFAULT_SUBMISSION_COLUMNS,
  SUBMISSION_COLUMN_IDS,
  type SubmissionColumnId,
} from "./submission-columns";
import type { SubmissionFilter } from "../routes/submissions.queries";

export type SavedViewFilters = Omit<SubmissionFilter, "eventId" | "q">;

export interface SavedViewConfig {
  q: string;
  filters: SavedViewFilters;
  sort: "newest" | "updated" | "title" | "score";
  columns: SubmissionColumnId[];
}

export interface BuiltInSavedView {
  id: string;
  name: string;
  built_in: true;
  config: SavedViewConfig;
  created_at: null;
  updated_at: null;
}

function columnsWithTitle(columns: readonly SubmissionColumnId[]): SubmissionColumnId[] {
  const unique = [...new Set(columns)];
  if (unique.includes("title")) return unique;
  // Keep the required Title column in the registry's natural position relative
  // to any earlier visible columns while preserving the user's chosen order.
  const titleIndex = SUBMISSION_COLUMN_IDS.indexOf("title");
  const beforeTitle = unique.filter((id) => SUBMISSION_COLUMN_IDS.indexOf(id) < titleIndex).length;
  unique.splice(beforeTitle, 0, "title");
  return unique;
}

export function normalizeSavedViewConfig(input: Partial<SavedViewConfig>): SavedViewConfig {
  const columns = columnsWithTitle(input.columns?.length ? input.columns : [...DEFAULT_SUBMISSION_COLUMNS]);
  return {
    q: input.q?.trim() ?? "",
    filters: { ...(input.filters ?? {}) },
    sort: input.sort ?? "newest",
    columns,
  };
}

export const BUILT_IN_SAVED_VIEWS: readonly BuiltInSavedView[] = [
  {
    id: "all-submissions",
    name: "All submissions",
    built_in: true,
    config: normalizeSavedViewConfig({ q: "", filters: {}, sort: "newest", columns: [...DEFAULT_SUBMISSION_COLUMNS] }),
    created_at: null,
    updated_at: null,
  },
  {
    id: "drafts-needing-attention",
    name: "Drafts needing attention",
    built_in: true,
    config: normalizeSavedViewConfig({
      q: "",
      filters: { status: "draft" },
      sort: "updated",
      columns: ["title", "speakers", "status", "updated", "missing"],
    }),
    created_at: null,
    updated_at: null,
  },
  {
    id: "decided-not-notified",
    name: "Decided · not notified",
    built_in: true,
    config: normalizeSavedViewConfig({
      q: "",
      filters: { status: "not_notified" },
      sort: "newest",
      columns: ["id", "title", "speakers", "status", "notified", "updated"],
    }),
    created_at: null,
    updated_at: null,
  },
] as const;

export function builtInSavedView(id: string): BuiltInSavedView | undefined {
  return BUILT_IN_SAVED_VIEWS.find((view) => view.id === id);
}
