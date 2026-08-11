import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../migrations/0002_venue_geography.sql", import.meta.url), "utf8");

test("CONTRACT · venue geography is an additive migration with bounded coordinates and access minutes", () => {
  assert.match(migration, /ALTER TABLE buildings ADD COLUMN lat REAL[\s\S]*CHECK \(lat IS NULL OR lat BETWEEN -90 AND 90\)/);
  assert.match(migration, /ALTER TABLE buildings ADD COLUMN lng REAL[\s\S]*CHECK \(lng IS NULL OR lng BETWEEN -180 AND 180\)/);
  assert.match(migration, /ALTER TABLE buildings ADD COLUMN access_minutes INTEGER NOT NULL DEFAULT 0[\s\S]*CHECK \(access_minutes >= 0\)/);
  assert.doesNotMatch(migration, /CREATE TABLE buildings/);
});
