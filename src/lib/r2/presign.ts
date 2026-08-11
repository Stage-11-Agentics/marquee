/**
 * SigV4 PUT signing against Cloudflare's documented R2 S3 API pattern.
 * Constructs only `https://{account}.r2.cloudflarestorage.com/{bucket}/{key}`
 * — trap 9: a custom/media domain is never a valid signing target, and this
 * module has no configuration knob that could redirect it there.
 */

import { AwsClient } from "aws4fetch";

export const PRESIGN_EXPIRY_SECONDS = 10 * 60;

export interface R2SigningConfig {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface PresignedPut {
  url: string;
  requiredHeaders: Record<string, string>;
  expiresAt: number;
}

/** The only S3 API origin this module will ever sign against. */
export function r2S3Endpoint(accountId: string): string {
  return `${accountId}.r2.cloudflarestorage.com`;
}

export async function presignPut(
  config: R2SigningConfig,
  params: { key: string; contentType: string; nowMs: number },
): Promise<PresignedPut> {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });

  const endpoint = r2S3Endpoint(config.accountId);
  const objectUrl = new URL(
    `https://${endpoint}/${config.bucketName}/${params.key.split("/").map(encodeURIComponent).join("/")}`,
  );
  objectUrl.searchParams.set("X-Amz-Expires", String(PRESIGN_EXPIRY_SECONDS));

  const signed = await client.sign(
    new Request(objectUrl, {
      method: "PUT",
      headers: {
        "content-type": params.contentType,
        "if-none-match": "*",
      },
    }),
    { aws: { signQuery: true } },
  );

  const signedUrl = new URL(signed.url);
  if (signedUrl.hostname !== endpoint) {
    // Defense in depth for trap 9: refuse to hand back a URL whose host
    // drifted from the account S3 endpoint, however that could happen.
    throw new Error(`presign produced an unexpected host: ${signedUrl.hostname}`);
  }

  return {
    url: signed.url,
    requiredHeaders: {
      "content-type": params.contentType,
      "if-none-match": "*",
    },
    expiresAt: params.nowMs + PRESIGN_EXPIRY_SECONDS * 1000,
  };
}
