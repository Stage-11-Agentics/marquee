import { expect, test } from "vitest";

import { presignPut, r2S3Endpoint } from "../../../src/lib/r2/presign";

const FAKE_CONFIG = {
  accountId: "fake-account-id",
  bucketName: "fake-bucket",
  accessKeyId: "fake-access-key-id",
  secretAccessKey: "fake-secret-access-key",
};

test("CONTRACT · trap 9 — presigned PUT always targets {account}.r2.cloudflarestorage.com, never a custom domain", async () => {
  const presigned = await presignPut(FAKE_CONFIG, {
    key: "uploads/evt_1/draft_file/att_1-abc.pdf",
    contentType: "application/pdf",
    nowMs: 1_700_000_000_000,
  });
  const url = new URL(presigned.url);
  expect(url.hostname).toBe(r2S3Endpoint(FAKE_CONFIG.accountId));
  expect(url.hostname).not.toContain("marquee.example");
  expect(url.pathname).toBe(`/${FAKE_CONFIG.bucketName}/uploads/evt_1/draft_file/att_1-abc.pdf`);
});

test("CONTRACT · presign expires 10 minutes out and pins Content-Type + If-None-Match", async () => {
  const nowMs = 1_700_000_000_000;
  const presigned = await presignPut(FAKE_CONFIG, {
    key: "uploads/evt_1/draft_file/att_2.pdf",
    contentType: "application/pdf",
    nowMs,
  });
  expect(presigned.expiresAt).toBe(nowMs + 10 * 60 * 1000);
  expect(presigned.requiredHeaders["content-type"]).toBe("application/pdf");
  expect(presigned.requiredHeaders["if-none-match"]).toBe("*");
});
