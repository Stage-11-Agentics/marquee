import { expect, test } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";

import { RESEND_SENDER, readResendIdentity } from "../../src/lib/mail/config";
import { readInstanceStatus, type InstanceStatusEnvironment } from "../../src/lib/instance-status";
import { ServerPanel } from "../../src/ui/setup/ServerPanel";

const URL = "https://marquee.example.test/dashboard";

test("CONTRACT · server rows lead with the four organizer jobs in fixed order", () => {
  const rows = readInstanceStatus({}, URL);
  expect(rows.map((row) => row.key)).toEqual(["mail", "uploads", "spam", "domain"]);
  expect(rows.map((row) => row.label)).toEqual([
    "Email sending",
    "File uploads",
    "Spam protection",
    "Web address",
  ]);
  expect(rows.map((row) => row.configured)).toEqual([false, false, false, true]);
  expect(rows[0]).toMatchObject({ sender: null, account: null });
});

test("CONTRACT · mail status and identity come from bindings, never a stored flag", () => {
  const withoutBinding = readInstanceStatus(
    { INSTANCE_MAIL_CONFIGURED: "true" } as unknown as InstanceStatusEnvironment,
    URL,
  );
  expect(withoutBinding[0]?.configured).toBe(false);
  expect(readResendIdentity({ RESEND_ACCOUNT_NAME: "invented-without-key" })).toEqual({ sender: null, account: null });

  const rows = readInstanceStatus({ RESEND_API_KEY: "re_test_key", RESEND_ACCOUNT_NAME: "stage11-agentics" }, URL);
  expect(rows[0]).toMatchObject({ configured: true, sender: RESEND_SENDER, account: "stage11-agentics" });
  expect(readResendIdentity({ RESEND_API_KEY: "re_test_key" })).toEqual({ sender: RESEND_SENDER, account: null });
});

test("AC-311 · the Server panel keeps an unconfigured Airtable row visible with its settings door", () => {
  const html = renderToString(h(ServerPanel, { showDemoControls: false }));
  expect(html).toContain("Airtable mirror");
  expect(html).toContain("not set up");
  expect(html).toContain('href="/settings/airtable"');
  expect(html).toContain("Connect Airtable");
});
