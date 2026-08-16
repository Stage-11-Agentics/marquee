import { beforeEach, describe, expect, test, vi } from "vitest";

import { idempotencyKeyForCompose, type ComposeIdempotencyRef } from "../../src/ui/shell/compose-idempotency";

describe("compose idempotency keys", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("compose-1")
      .mockReturnValueOnce("compose-2") });
  });

  test("CONTRACT · MRQ-226 · a client retry reuses its compose key and an edited compose gets a new key", () => {
    const ref: ComposeIdempotencyRef = { current: null };

    const first = idempotencyKeyForCompose(ref, "same-compose");
    const retry = idempotencyKeyForCompose(ref, "same-compose");
    const edited = idempotencyKeyForCompose(ref, "edited-compose");

    expect(first).toBe("compose-1");
    expect(retry).toBe(first);
    expect(edited).toBe("compose-2");
    expect(edited).not.toBe(first);
  });
});
