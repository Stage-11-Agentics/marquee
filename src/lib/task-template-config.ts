import { ABSOLUTE_MAX_BYTES, DEFAULT_FILE_MAX_BYTES } from "./r2/policy";

export interface TaskFileConfig {
  accept: string[];
  maxBytes: number;
}

export class TaskFileConfigError extends Error {
  readonly field: "accept" | "maxBytes" | "file_config";

  constructor(message: string, field: "accept" | "maxBytes" | "file_config") {
    super(message);
    this.name = "TaskFileConfigError";
    this.field = field;
  }
}

const EXTENSION = /^[a-z0-9](?:[a-z0-9_-]{0,31})$/;

function normalizeAccept(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TaskFileConfigError("accepted file types must be a list", "accept");
  }

  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new TaskFileConfigError("each accepted file type must be text", "accept");
    }
    const extension = entry.trim().toLowerCase().replace(/^\.+/, "");
    if (!EXTENSION.test(extension)) {
      throw new TaskFileConfigError("accepted file types must be simple extensions such as pdf or pptx", "accept");
    }
    if (!normalized.includes(extension)) normalized.push(extension);
  }
  if (normalized.length === 0) {
    throw new TaskFileConfigError("choose at least one accepted file type", "accept");
  }
  return normalized;
}

function normalizeMaxBytes(value: unknown): number {
  if (value === undefined) return DEFAULT_FILE_MAX_BYTES;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new TaskFileConfigError("maximum size must be a positive whole number of bytes", "maxBytes");
  }
  return Math.min(value, ABSOLUTE_MAX_BYTES);
}

/** Normalize the one canonical file-task representation before it is stored. */
export function normalizeTaskFileConfig(value: unknown): TaskFileConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TaskFileConfigError("file configuration must be an object or null", "file_config");
  }
  const record = value as Record<string, unknown>;
  return { accept: normalizeAccept(record.accept), maxBytes: normalizeMaxBytes(record.maxBytes) };
}

/** Read legacy seeded configs without changing the stored JSON until an edit is saved. */
export function readTaskFileConfig(value: string | null): TaskFileConfig | null {
  if (value === null) return null;
  try {
    return normalizeTaskFileConfig(JSON.parse(value));
  } catch {
    return null;
  }
}
