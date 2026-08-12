/** MRQ-122's local synthetic-avatar manifest and truthful fallback contract. */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  INTENTIONAL_PUBLIC_HEADSHOT_FALLBACK_SLUGS,
  SYNTHETIC_PUBLIC_HEADSHOT_SLUGS,
  syntheticPublicHeadshotUrl,
} from "../../src/lib/public-headshots.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assetDirectory = resolve(repositoryRoot, "public/headshots");

test("EMB-04 + EMB-12 · the seeded avatar manifest is local, synthetic, and intentionally incomplete", () => {
  assert.equal(SYNTHETIC_PUBLIC_HEADSHOT_SLUGS.length, 27);
  assert.equal(INTENTIONAL_PUBLIC_HEADSHOT_FALLBACK_SLUGS.length, 3);
  for (const slug of SYNTHETIC_PUBLIC_HEADSHOT_SLUGS) {
    const asset = resolve(assetDirectory, `${slug}.svg`);
    assert.ok(existsSync(asset), `${slug} has no committed static avatar`);
    const source = readFileSync(asset, "utf8");
    assert.match(source, /Deliberately synthetic monogram avatar/);
    assert.doesNotMatch(source, /<image\b|(?:href|src)=["']https?:\/\//i);
  }

  assert.equal(syntheticPublicHeadshotUrl("Grace Isford", true), "/headshots/grace-isford.svg");
  assert.equal(syntheticPublicHeadshotUrl("Aarush Selvan", true), null, "the intentional fallback must remain reachable");
  assert.equal(syntheticPublicHeadshotUrl("Grace Isford", false), null, "real/non-demo identities never inherit demo art");
});
