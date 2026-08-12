import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";

import { SpeakerAvatar, speakerHeadshotUrl } from "../../src/ui/speakers/SpeakerAvatar";

test("CONTRACT · MRQ-153 — an attached headshot renders through the event-scoped serve path", () => {
  const html = renderToString(h(SpeakerAvatar, {
    eventId: "evt_identity",
    personId: "per_priya",
    name: "Priya Raman",
    attachmentId: "att_photo_v2",
    size: 48,
  }));
  expect(speakerHeadshotUrl("evt_identity", "per_priya", "att_photo_v2")).toBe("/api/v1/events/evt_identity/people/per_priya/headshot?v=att_photo_v2");
  expect(html).toContain("<img");
  expect(html).toContain("/api/v1/events/evt_identity/people/per_priya/headshot?v=att_photo_v2");
  expect(html).toContain('alt="Priya Raman headshot"');
});

test("CONTRACT · MRQ-153 — no headshot renders truthful initials and no image capability", () => {
  const html = renderToString(h(SpeakerAvatar, {
    eventId: "evt_identity",
    personId: "per_marcus",
    name: "Marcus Okafor",
    attachmentId: null,
  }));
  expect(speakerHeadshotUrl("evt_identity", "per_marcus", null)).toBeNull();
  expect(html).not.toContain("<img");
  expect(html).toContain("MO");
});
