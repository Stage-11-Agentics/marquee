import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";

import type { FileVersion, FileVersionList } from "../../src/lib/files/versions";
import { CAPABILITY_LINK_NOTE, FileVersions } from "../../src/ui/files/FileVersions";

/**
 * MRQ-115 · what a version list says out loud.
 *
 * CNT-04 wants two versions with the latest clearly marked and the older one
 * still reachable by a control. CNT-02 wants the speaker to see the FILENAME
 * after uploading, not a checkmark. Both are claims about rendered text, so
 * they are tested as rendered text.
 */

const MARCH_2 = Date.UTC(2027, 2, 2, 17, 30, 0);
const MARCH_3 = Date.UTC(2027, 2, 3, 9, 15, 0);

function version(overrides: Partial<FileVersion> = {}): FileVersion {
  return {
    attachment_id: "att_v1",
    version: 1,
    filename: "slides.pdf",
    content_type: "application/pdf",
    size_bytes: 4_000_000,
    uploaded_at: MARCH_2,
    is_latest: false,
    url: "https://media.marquee.test/api/v1/media/uploads/evt/task_upload/att_v1.pdf",
    ...overrides,
  };
}

const TWO_VERSIONS: FileVersionList = {
  owner_type: "task_upload",
  owner_id: "task_slides",
  versions: [
    version({ attachment_id: "att_v2", version: 2, size_bytes: 4_300_000, uploaded_at: MARCH_3, is_latest: true, url: "https://media.marquee.test/api/v1/media/uploads/evt/task_upload/att_v2.pdf" }),
    version(),
  ],
  latest: version({ attachment_id: "att_v2", version: 2, size_bytes: 4_300_000, uploaded_at: MARCH_3, is_latest: true, url: "https://media.marquee.test/api/v1/media/uploads/evt/task_upload/att_v2.pdf" }),
  version_count: 2,
  latest_source: "pointer",
};

test("MRQ-115/CNT-02 · the summary names the file, its version, when it arrived, and how big it is", () => {
  const html = renderToString(h(FileVersions, { list: TWO_VERSIONS, compact: true }));
  expect(html).toContain("slides.pdf");
  expect(html).toContain("v2 of 2");
  expect(html).toContain("Mar 3, 2027");
  expect(html).toContain("4.1 MB");
  // A collapsed row still offers the file itself — evidence, not a claim.
  expect(html).toContain('href="https://media.marquee.test/api/v1/media/uploads/evt/task_upload/att_v2.pdf"');
});

test("MRQ-115/CNT-04 · both versions render, the latest is marked, and the older one keeps its own download control", () => {
  const html = renderToString(h(FileVersions, { list: TWO_VERSIONS }));
  expect(html).toContain("Current · v2 of 2");
  expect(html).toContain("Previous version");
  expect(html).toContain("att_v1.pdf");
  expect(html).toContain("att_v2.pdf");
  expect(html.match(/>Download</g)).toHaveLength(3); // summary + one per version
  expect(html).toContain("1 earlier version kept and still downloadable.");
});

test("MRQ-115 · the capability-URL caveat is stated where the link is offered, not buried", () => {
  const html = renderToString(h(FileVersions, { list: TWO_VERSIONS }));
  // Copying a link hands out the file. Saying so is the honest version of
  // shipping the control at all.
  expect(html).toContain(CAPABILITY_LINK_NOTE);
  expect(CAPABILITY_LINK_NOTE).toContain("not signed in to the conference");
  expect(html).toContain("Copy link");
});

test("MRQ-115 · a single version says so rather than implying a history it does not have", () => {
  const only = version({ attachment_id: "att_v1", version: 1, is_latest: true });
  const html = renderToString(h(FileVersions, {
    list: { owner_type: "task_upload", owner_id: "task_slides", versions: [only], latest: only, version_count: 1, latest_source: "pointer" },
  }));
  expect(html).toContain("v1 of 1");
  expect(html).toContain("This is the only version uploaded so far.");
  expect(html).not.toContain("earlier version");
});

test("MRQ-115 · nothing uploaded renders a true sentence, not an empty box", () => {
  const html = renderToString(h(FileVersions, { list: null, emptyCopy: "Marcus has not uploaded a deck yet." }));
  expect(html).toContain("Marcus has not uploaded a deck yet.");
  const fallback = renderToString(h(FileVersions, { list: null }));
  expect(fallback).toContain("No file has been uploaded against this deliverable yet.");
});
