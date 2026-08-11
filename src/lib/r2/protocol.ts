/**
 * Shared inert request/response types for the upload pipeline.
 *
 * This module is imported with `import type` from both the Worker routes and
 * the browser client (`src/ui/upload/upload-client.ts`). It must never import
 * a runtime module or reference a binding/secret name so the client bundle
 * stays free of signer material (enforced by the vite bundle-hygiene scan).
 */

export const UPLOAD_OWNER_TYPES = [
  "person_headshot",
  "task_upload",
  "event_logo",
  "draft_file",
  "submission_file",
] as const;

export type UploadOwnerType = (typeof UPLOAD_OWNER_TYPES)[number];

export interface UploadOwnerConfig {
  /** Extension allowlist from the task template or form field, e.g. ["pdf"]. */
  accept?: string[];
  /** Owner-configured size ceiling; always bounded by the absolute ceiling. */
  maxBytes?: number;
}

export interface PublicSignUploadRequest {
  draftId: string;
  resumeToken: string;
  fieldKey: string;
  turnstileToken: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface AuthenticatedSignUploadRequest {
  ownerType: UploadOwnerType;
  ownerId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface SignedUpload {
  attachmentId: string;
  putUrl: string;
  requiredHeaders: Record<string, string>;
  /** Epoch milliseconds after which the presigned PUT URL is refused. */
  expiresAt: number;
  completionToken: string;
  maxBytes: number;
}

export interface CompletedUpload {
  attachmentId: string;
  status: "ready";
  /** Stable separate-origin media URL; the only outbound media representation. */
  url: string;
  contentType: string;
  sizeBytes: number;
  /** Cloudflare image-transformation derivatives for headshots. */
  variants?: Record<string, string>;
}

export interface CompleteUploadRequest {
  completionToken?: string;
}
