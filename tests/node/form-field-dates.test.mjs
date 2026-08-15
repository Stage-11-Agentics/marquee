import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFile(resolve(root, path), "utf8");

const [migration, initialMigration, applier, seed, formsRoutes, publicRoutes, builder, portal, publicForm] = await Promise.all([
  read("migrations/0008_form_field_dates.sql"),
  read("migrations/0001_init.sql"),
  read("tests/integration/apply-migrations.ts"),
  read("scripts/seed/event.ts"),
  read("src/routes/forms.routes.ts"),
  read("src/routes/public-form.routes.ts"),
  read("src/ui/forms/FormsPage.tsx"),
  // The portal is two files since MRQ-214 extracted the task machinery the
  // sponsor portal shares. Read both, so the assertion follows the code.
  Promise.all([read("src/ui/portal/PortalPage.tsx"), read("src/ui/portal/task-machinery.tsx")])
    .then((parts) => parts.join("\n")),
  read("src/ui/public/form/PublicForm.tsx"),
]);

test("CONTRACT · MRQ-95 rebuilds form fields and answers without changing the immutable initial migration", () => {
  assert.doesNotMatch(initialMigration, /'date'/);
  assert.match(migration, /CREATE TABLE form_fields_new/);
  assert.match(migration, /type IN \([\s\S]*?'number', 'date'[\s\S]*?\)/);
  assert.match(migration, /INSERT INTO form_fields_new SELECT \* FROM form_fields;/);
  assert.match(migration, /CREATE TABLE submission_answers_new/);
  assert.match(migration, /field_id TEXT NOT NULL REFERENCES form_fields_new\(id\)/);
  assert.match(migration, /INSERT INTO submission_answers_new SELECT \* FROM submission_answers;/);
  assert.match(migration, /DROP TABLE submission_answers;\s*DROP TABLE form_fields;/);
  assert.match(migration, /ALTER TABLE form_fields_new RENAME TO form_fields;/);
  assert.match(migration, /ALTER TABLE submission_answers_new RENAME TO submission_answers;/);
  assert.match(migration, /CREATE UNIQUE INDEX uq_form_fields_form_key/);
  assert.match(migration, /CREATE INDEX idx_form_fields_form_position/);
  assert.match(migration, /CREATE UNIQUE INDEX uq_submission_answers_submission_field/);
  assert.match(migration, /CREATE INDEX idx_submission_answers_field_submission/);
});

test("CONTRACT · MRQ-95 registers the migration after the existing schema sequence", () => {
  assert.match(applier, /0008_form_field_dates\.sql\?raw/);
  const previous = applier.indexOf("embedWidgetKindsMigrationSql)");
  const registered = applier.indexOf("formFieldDatesMigrationSql)");
  assert.ok(previous >= 0 && registered > previous, "0008 must apply after 0007");
});

test("CONTRACT · MRQ-95 exposes Date through the organizer, API, seed, and native controls", () => {
  assert.equal((formsRoutes.match(/"date"/g) ?? []).length, 2, "forms API must accept date in both field schemas");
  assert.equal((publicRoutes.match(/"date"/g) ?? []).length, 1, "public API must expose date fields");
  assert.match(builder, /\{ value: "date", label: "Date" \}/);
  assert.match(builder, /field\.type === "date" \? "date"/);
  assert.match(portal, /field\.type === "date" \? "date"/);
  assert.match(publicForm, /field\.type === "date" \? "date"/);
  assert.match(seed, /\["arrival_date", "Arrival date", "date", 1, 0\]/);
  assert.match(seed, /\["departure_date", "Departure date", "date", 1, 1\]/);
});
