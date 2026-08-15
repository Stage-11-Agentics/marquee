/**
 * The sponsor handbook — the same machinery the speaker handbook uses: static
 * markdown authored per conference, rendered inside the portal (SPEC AC-233's
 * shape, applied to the sponsor seat).
 *
 * It is chapters rather than one document because a sponsor arrives asking one
 * question at a time — how do I get my crates in, what file do you need, when do
 * passes work — and a scroll is a worse answer than a title.
 *
 * The booth chapter is present only for a sponsorship that has a booth. A
 * load-in guide shown to a sponsor with no booth is not neutral: it makes them
 * wonder what they missed.
 */

export interface SponsorHandbookChapter {
  id: string;
  label: string;
  markdown: string;
}

export interface SponsorHandbookInput {
  eventSlug: string;
  hasBooth: boolean;
  boothNumber: string | null;
  organizerEmail: string | null;
}

function boothChapter(boothNumber: string | null): SponsorHandbookChapter {
  const crateLine = boothNumber
    ? `Crates must be tagged with your booth number (**${boothNumber}**).`
    : "Crates must be tagged with your booth number.";
  return {
    id: "load-in",
    label: "Booth & load-in guide",
    markdown: `## Getting in

Load-in runs the day before the conference opens, at the freight dock named on your booth card. Book a slot; walk-ups queue behind booked slots. ${crateLine}

## While you are there

Empties are stored by the decorator and returned at the close of the last conference day. Tear-down completes the same evening — the hall has to be clear for the venue's next tenant.

## Before you arrive

Your certificate of insurance has to be on file before dock access. It is one of your deliverables, and the dock will turn away a crew without it.`,
  };
}

const BRAND_CHAPTER: SponsorHandbookChapter = {
  id: "brand",
  label: "Brand usage & logo specs",
  markdown: `## What we need

A vector mark, exported as **PDF**. It renders on the event site, the sponsor wall, and printed signage, and signage prints at a size raster files cannot survive. Every design tool exports vector PDF; if yours is asking, that is the answer.

## What we do with it

Monochrome variants are derived automatically, so supply the primary mark only. Alt text travels with it wherever it appears, which is why the company-details deliverable asks for it.`,
};

function faqChapter(organizerEmail: string | null): SponsorHandbookChapter {
  const contactLine = organizerEmail
    ? `For anything not covered here, email your organizer contact at **${organizerEmail}**.`
    : "For anything not covered here, email your organizer contact — their address is in the header of this page.";
  return {
    id: "faq",
    label: "Sponsor FAQ",
    markdown: `## Passes

Passes activate at check-in with a government ID. Names on the booth staff list can change until the week before the conference.

## Your Sessions

Sessions are read-only here on purpose. Everything about them — the speaker, the title, the description — is filled by completing the deliverable that asks for it, so the conference and your portal never disagree about what has been settled.

## Recordings and leads

Session recordings are published under the conference's standard license. Lead-scan exports land in this portal within a day of each conference day.

## Anything else

${contactLine}`,
  };
}

export function sponsorHandbookChapters(input: SponsorHandbookInput): SponsorHandbookChapter[] {
  return [
    ...(input.hasBooth ? [boothChapter(input.boothNumber)] : []),
    BRAND_CHAPTER,
    faqChapter(input.organizerEmail),
  ];
}
