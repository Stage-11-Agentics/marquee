import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";

import {
  comparePublicSpeakerDirectoryEntries,
  publicSpeakerSurname,
} from "../../src/lib/public-site";
import { PublicSpeakerDirectoryPage } from "../../src/ui/public/agenda/PublicAgendaPage";

test("CONTRACT · MRQ-143 · public speaker directory orders by surname and preserves edge-case names", () => {
  const speakers = [
    { id: "aicha", name: "Aïcha Ndiaye-Kovács" },
    { id: "lukasz", name: "Łukasz Żółć-Wiśniewski" },
    { id: "aarush", name: "Aarush Selvan" },
    { id: "aparna", name: "Aparna Dhinkaran" },
    { id: "mononym", name: "swyx" },
    { id: "barr", name: "Barr Yaron" },
  ];

  const ordered = speakers.toSorted(comparePublicSpeakerDirectoryEntries);
  expect(ordered.map((speaker) => speaker.name)).toEqual([
    "Aparna Dhinkaran",
    "Aïcha Ndiaye-Kovács",
    "Aarush Selvan",
    "swyx",
    "Barr Yaron",
    "Łukasz Żółć-Wiśniewski",
  ]);
  expect(publicSpeakerSurname("Ndiaye-Kovács, Aïcha")).toBe("Ndiaye-Kovács");
  expect(publicSpeakerSurname("swyx")).toBe("swyx");

  const html = renderToString(h(PublicSpeakerDirectoryPage, {
    data: {
      event: {
        id: "event",
        slug: "demo",
        name: "Demo Conference",
        tagline: null,
        startsOn: "2026-10-12",
        endsOn: "2026-10-13",
        timezone: "UTC",
        venue: null,
        accent: null,
      },
      venue: { buildingName: null, showComparison: false },
      speakers: ordered.map((speaker) => ({
        ...speaker,
        slug: speaker.id,
        title: null,
        company: null,
        bio: null,
        headshotUrl: null,
        socialLinks: [],
      })),
      filters: { q: null },
    },
  }));
  expect([...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((match) => match[1])).toEqual(ordered.map((speaker) => speaker.name));
});
