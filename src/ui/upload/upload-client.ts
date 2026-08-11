/**
 * Framework-neutral XHR PUT transport — XHR (not fetch) is required for
 * upload progress events. Client-safe: only `import type` from the R2
 * module so no signer/binding code can enter the browser bundle.
 */

import type { SignedUpload } from "../../lib/r2/protocol";

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
    xhr.onerror = () => reject(new Error("upload PUT network error"));
    xhr.onabort = () => reject(new Error("upload PUT aborted"));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
