import { expect, test } from "vitest";

import {
  comparePublicSpeakerDirectoryEntries,
  publicSpeakerSurname,
} from "../../src/lib/public-site";

test("CONTRACT · MRQ-143 · public speaker directory orders by surname and preserves edge-case names", () => {
  const speakers = [
    { id: "aicha", name: "Aïcha Ndiaye-Kovács" },
    { id: "lukasz", name: "Łukasz Żółć-Wiśniewski" },
    { id: "aarush", name: "Aarush Selvan" },
    { id: "aparna", name: "Aparna Dhinkaran" },
    { id: "mononym", name: "swyx" },
    { id: "barr", name: "Barr Yaron" },
  ];

  expect(speakers.toSorted(comparePublicSpeakerDirectoryEntries).map((speaker) => speaker.name)).toEqual([
    "Aparna Dhinkaran",
    "Aïcha Ndiaye-Kovács",
    "Aarush Selvan",
    "swyx",
    "Barr Yaron",
    "Łukasz Żółć-Wiśniewski",
  ]);
  expect(publicSpeakerSurname("Ndiaye-Kovács, Aïcha")).toBe("Ndiaye-Kovács");
  expect(publicSpeakerSurname("swyx")).toBe("swyx");
});
