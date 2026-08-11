-- Correlate the domain audit trail with the operational log.
--
-- `audit_log` answers "who changed this record"; the structured request log
-- answers "what the system did and where it broke". Until now those two
-- accounts of the same moment shared no key, so reconstructing an incident
-- meant matching on timestamps and hoping. One nullable column joins them.
--
-- Nullable by necessity, not by laziness: rows written before this migration
-- have no request to point at, and rows written from a cron trigger have no
-- inbound request at all. A NULL here means "no originating request", which is
-- a true statement about a scheduled sweep — it is never a write that lost its
-- id. Queue-borne writes DO carry one, propagated in the message body, so an
-- acceptance stays followable from the click through to the mail send.
--
-- 0001 through 0005 are immutable; this migration is additive.
ALTER TABLE audit_log ADD COLUMN request_id TEXT;

-- The access path this column exists for: given one request id from a log line,
-- an error envelope, or a user's diagnostic report, find every record that
-- request changed. `created_at` keeps the result in write order.
CREATE INDEX idx_audit_request ON audit_log(request_id, created_at);
