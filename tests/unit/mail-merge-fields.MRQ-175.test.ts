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
  expect(COMMUNICATION_MERGE_FIELDS).not.toContain("auth.link");
  expect(unknownMergeFieldsForCommunication("Sign in: {{auth.link}}")).toEqual(["auth.link"]);
  expect(unknownMergeFieldsForCommunication("Hi {{speaker.first_name}}")).toEqual([]);
});
