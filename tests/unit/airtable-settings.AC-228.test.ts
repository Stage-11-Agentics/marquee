import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";

import { AirtableConnectionFacts, AirtableHealthCard, type MirrorStatus } from "../../src/ui/settings/AirtablePage";

const status: MirrorStatus = {
  base_id: "app_mrq223",
  base_url: "https://airtable.com/app_mrq223",
  configured: true,
  last_error: null,
  last_sync_at: Date.UTC(2026, 7, 15, 12),
  last_verified_at: Date.UTC(2026, 7, 15, 11),
  mapped: true,
  queued: 7,
  set_at: Date.UTC(2026, 7, 15, 10),
  stuck: 2,
  tables: [
    { airtable_table_id: "tbl_submissions", local_row_count: 18, remote_row_count: 19, last_sync_at: Date.UTC(2026, 7, 15, 12), name: "submissions" },
    { airtable_table_id: "tbl_tasks", local_row_count: 11, remote_row_count: 11, last_sync_at: Date.UTC(2026, 7, 15, 12), name: "speaker_tasks" },
    { airtable_table_id: "tbl_people", local_row_count: 4, remote_row_count: 5, last_sync_at: Date.UTC(2026, 7, 15, 12), name: "people" },
  ],
  token_fingerprint: "sha256:masked",
  traffic_assisted: true,
  webhook_expires_at: Date.UTC(2026, 7, 22, 12),
};

test("AC-228 · Airtable settings renders the base link, both row counts, last sync, and outbox depth", () => {
  const html = [
    renderToString(h(AirtableConnectionFacts, { status })),
    renderToString(h(AirtableHealthCard, {
      status,
      pending: null,
      expiry: "The Airtable webhook expires soon.",
      onSync: () => undefined,
      onDisconnect: () => undefined,
    })),
  ].join(" ");

  expect(html).toContain('href="https://airtable.com/app_mrq223"');
  expect(html).toContain("Open base");
  expect(html).toContain(">7<");
  expect(html).toContain(">2<");
  expect(html).toContain("Marquee rows");
  expect(html).toContain("Airtable rows");
  expect(html).toContain("As of last sync");
  expect(html).toContain("Both counts are as of last sync");
  expect(html).toContain("Webhook renewal");
});
