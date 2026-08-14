/**
 * Framework-neutral XHR PUT transport — XHR (not fetch) is required for
 * upload progress events. Client-safe: only `import type` from the R2
 * module so no signer/binding code can enter the browser bundle.
 */

import type { SignedUpload } from "../../lib/r2/protocol";

export const UPLOAD_PUT_NETWORK_ERROR = "upload PUT network error";
export const UPLOAD_PUT_ABORTED = "upload PUT aborted";
export const UPLOAD_PUT_TIMED_OUT = "upload PUT timed out";

/** A stalled browser PUT must become a recoverable state, never an open-ended spinner. */
export const UPLOAD_PUT_TIMEOUT_MS = 30_000;

const SPEAKER_UPLOAD_FAILURE = "We couldn't upload that file. Check your connection and try again.";
const SPEAKER_UPLOAD_HTTP_FAILURE = "That upload didn't go through. Retry when you're ready.";
const SPEAKER_UPLOAD_TIMEOUT = "That upload took too long and was stopped. No new file was saved. Retry when you're ready.";

export interface SpeakerUploadFailureOptions {
  /** A replacement must explicitly preserve the version the server still holds. */
  hasPreviousVersion?: boolean;
}

function previousVersionRecovery(hasPreviousVersion: boolean): string {
  return hasPreviousVersion
    ? "Your previous version is still current. Retry when you're ready."
    : "No new file was saved. Retry when you're ready.";
}

function uploadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Convert transport failures into speaker copy without hiding the diagnostic Error. */
export function speakerUploadFailureMessage(error: unknown, options: SpeakerUploadFailureOptions = {}): string | null {
  const message = uploadErrorMessage(error);
  const recovery = previousVersionRecovery(options.hasPreviousVersion === true);
  if (message === UPLOAD_PUT_NETWORK_ERROR) {
    return options.hasPreviousVersion
      ? `We couldn't upload that file. ${recovery}`
      : SPEAKER_UPLOAD_FAILURE;
  }
  if (message === UPLOAD_PUT_TIMED_OUT) {
    return options.hasPreviousVersion
      ? `That upload took too long and was stopped. ${recovery}`
      : SPEAKER_UPLOAD_TIMEOUT;
  }
  if (/^upload PUT failed with status \d+$/.test(message)) {
    return options.hasPreviousVersion
      ? `That upload didn't go through. ${recovery}`
      : SPEAKER_UPLOAD_HTTP_FAILURE;
  }
  return null;
}

export function isUploadAborted(error: unknown): boolean {
  return uploadErrorMessage(error) === UPLOAD_PUT_ABORTED;
}

export function speakerUploadAbortedMessage(hasPreviousVersion = false): string {
  return `Upload canceled. ${previousVersionRecovery(hasPreviousVersion)}`;
}

export interface UploadProgressHandlers {
  onProgress?: (loaded: number, total: number) => void;
  onExpiredOrForbidden?: () => void;
}

export function putFileToR2(
  signed: SignedUpload,
  file: File,
  handlers: UploadProgressHandlers = {},
): { promise: Promise<void>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open("PUT", signed.putUrl, true);
    xhr.timeout = UPLOAD_PUT_TIMEOUT_MS;
    for (const [name, value] of Object.entries(signed.requiredHeaders)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) handlers.onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      if (xhr.status === 403 || xhr.status === 412) handlers.onExpiredOrForbidden?.();
      reject(new Error(`upload PUT failed with status ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error(UPLOAD_PUT_NETWORK_ERROR));
    xhr.onabort = () => reject(new Error(UPLOAD_PUT_ABORTED));
    xhr.ontimeout = () => reject(new Error(UPLOAD_PUT_TIMED_OUT));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
