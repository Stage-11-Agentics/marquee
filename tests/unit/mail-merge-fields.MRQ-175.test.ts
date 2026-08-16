import { expect, test } from "vitest";

import { DEFAULT_TEMPLATES } from "../../src/jobs/mail/templates";
import {
  COMMUNICATION_MERGE_FIELDS,
  MERGE_FIELDS,
  mergeFieldsIn,
  unknownMergeFieldsForCommunication,
} from "../../src/lib/mail-merge-fields";

test("CONTRACT · MRQ-175 · every shipped mail template uses a known merge field", () => {
  const known = new Set<string>(MERGE_FIELDS);
  const unknownByTemplate = Object.entries(DEFAULT_TEMPLATES).flatMap(([key, template]) =>
    mergeFieldsIn(template.subject, template.body_md)
      .filter((field) => !known.has(field))
      .map((field) => `${key}: {{${field}}}`),
  );

  expect(unknownByTemplate).toEqual([]);
});

test("CONTRACT · organizer communications do not advertise or queue auth-only links", () => {
  expect(MERGE_FIELDS).toContain("auth.link");
  expect(MERGE_FIELDS).toContain("draft.resume_link");
  expect(MERGE_FIELDS).toContain("draft.missing_fields");
  expect(COMMUNICATION_MERGE_FIELDS).not.toContain("auth.link");
  expect(COMMUNICATION_MERGE_FIELDS).not.toContain("draft.resume_link");
  expect(COMMUNICATION_MERGE_FIELDS).toContain("draft.missing_fields");
  expect(unknownMergeFieldsForCommunication("Sign in: {{auth.link}}")).toEqual(["auth.link"]);
  expect(unknownMergeFieldsForCommunication("Resume: {{draft.resume_link}}")).toEqual(["draft.resume_link"]);
  expect(unknownMergeFieldsForCommunication("Still needed: {{draft.missing_fields}}")).toEqual([]);
  expect(unknownMergeFieldsForCommunication("Hi {{speaker.first_name}}")).toEqual([]);
});
