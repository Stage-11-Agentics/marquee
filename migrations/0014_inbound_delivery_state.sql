-- Provider delivery is a second, asynchronous truth after the outbox hands a
-- message to Resend. It stays on the outbox row so the provider message id is
-- the only join required by the inbound webhook.
--
-- `status` remains the transport state for queued/sent/suppressed rows. A hard
-- bounce also moves a sent row to failed, while `delivery_state` preserves the
-- reason and lets the health surface distinguish a provider bounce from a send
-- that never left the building.
ALTER TABLE outbox ADD COLUMN delivery_state TEXT NOT NULL DEFAULT 'unknown'
  CHECK (delivery_state IN ('unknown', 'delivered', 'bounced_hard', 'bounced_soft', 'complained'));

ALTER TABLE outbox ADD COLUMN bounce_type TEXT
  CHECK (bounce_type IS NULL OR bounce_type IN ('Permanent', 'Transient', 'Undetermined'));

ALTER TABLE outbox ADD COLUMN bounce_subtype TEXT
  CHECK (bounce_subtype IS NULL OR bounce_subtype IN (
    'NoEmail', 'MailboxFull', 'Suppressed', 'MessageTooLarge',
    'ContentRejected', 'AttachmentRejected', 'General'
  ));

ALTER TABLE outbox ADD COLUMN delivered_at INTEGER;
ALTER TABLE outbox ADD COLUMN delivery_event_id TEXT;
ALTER TABLE outbox ADD COLUMN delivery_event_created_at INTEGER;

CREATE INDEX idx_outbox_provider_message_id ON outbox (provider_message_id);
