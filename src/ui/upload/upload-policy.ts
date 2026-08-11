export interface BrowserUploadFile {
  name: string;
  size: number;
}

function extensionOf(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? "";
  const dot = basename.lastIndexOf(".");
  return dot > 0 && dot < basename.length - 1 ? basename.slice(dot + 1).toLowerCase() : "";
}

export function acceptedExtensions(accept: readonly string[] | undefined): string[] {
  return [...new Set((accept ?? [])
    .map((entry) => entry.trim().toLowerCase().replace(/^\./, ""))
    .filter((entry) => /^[a-z0-9]+$/.test(entry)))];
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Fast browser feedback for task uploads. The sign and complete endpoints
 * repeat the extension/MIME/magic checks; this only prevents an avoidable
 * round trip and keeps the chosen file available for retry.
 */
export function validateClientUpload(
  file: BrowserUploadFile,
  options: { accept?: readonly string[]; maxBytes?: number | null },
): string | null {
  const extensions = acceptedExtensions(options.accept);
  const extension = extensionOf(file.name);
  if (extensions.length > 0 && !extensions.includes(extension)) {
    return `Choose a ${extensions.map((item) => `.${item}`).join(", ")} file.`;
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return "Choose a non-empty file.";
  if (options.maxBytes !== null && options.maxBytes !== undefined && file.size > options.maxBytes) {
    return `That file is ${formatBytes(file.size)}; the limit is ${formatBytes(options.maxBytes)}.`;
  }
  return null;
}
