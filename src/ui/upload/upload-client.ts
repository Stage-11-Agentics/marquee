/**
 * Framework-neutral XHR PUT transport — XHR (not fetch) is required for
 * upload progress events. Client-safe: only `import type` from the R2
 * module so no signer/binding code can enter the browser bundle.
 */

import type { SignedUpload } from "../../lib/r2/protocol";

export const UPLOAD_PUT_NETWORK_ERROR = "upload PUT network error";

const SPEAKER_UPLOAD_FAILURE = "We couldn't upload that file. Check your connection and try again.";

/** Convert transport failures into speaker copy without hiding the diagnostic Error. */
export function speakerUploadFailureMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  return message === UPLOAD_PUT_NETWORK_ERROR || message === "upload PUT aborted" || /^upload PUT failed with status \d+$/.test(message)
    ? SPEAKER_UPLOAD_FAILURE
    : null;
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
    xhr.onabort = () => reject(new Error("upload PUT aborted"));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
