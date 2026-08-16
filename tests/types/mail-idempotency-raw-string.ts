import type { EnqueueOutboxInput } from "../../src/jobs/mail/outbox";

// This fixture is intentionally invalid. The node test compiles it and asserts
// that the raw string is rejected at the EnqueueOutboxInput boundary.
export const rawStringEntityId: EnqueueOutboxInput = {
  db: null as never,
  eventId: "event-1",
  templateKey: "custom",
  // @ts-expect-error entity ids must come from IDEMPOTENCY_REGISTRY
  entityId: "recipient-1",
  personId: "person-1",
  toEmail: "speaker@example.com",
};

