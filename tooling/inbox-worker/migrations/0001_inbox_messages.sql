CREATE TABLE inbox_messages (
  id TEXT PRIMARY KEY NOT NULL,
  received_at TEXT NOT NULL,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT,
  raw_rfc822 TEXT NOT NULL
);

CREATE INDEX idx_inbox_messages_to_received_at
  ON inbox_messages (to_email, received_at);
