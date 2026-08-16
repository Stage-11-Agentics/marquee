/**
 * Keep one idempotency key for one compose while a request is retried. Editing
 * the compose changes its fingerprint and therefore starts a new send action;
 * a dropped connection followed by the same compose keeps the original key.
 */
export interface ComposeIdempotencyRef {
  current: { fingerprint: string; key: string } | null;
}

export function idempotencyKeyForCompose(
  ref: ComposeIdempotencyRef,
  fingerprint: string,
): string {
  if (ref.current?.fingerprint !== fingerprint) {
    ref.current = { fingerprint, key: crypto.randomUUID() };
  }
  return ref.current.key;
}
