/** @jsxImportSource preact */
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import type { DecisionPlanResponse } from "../../api/decision-plan";
import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Chip, EmptyState, PageHeader } from "../shell/components";
import { DecisionPlanPanel, DecisionPlanResultModal, type DecisionPlanApplyResult, type DecisionPlanSkip } from "../submissions/DecisionPlanPanel";
import "./announce.css";

type AnnounceSpeaker = {
  id: string;
  name: string;
  email: string;
  do_not_contact: boolean;
  public_link: string;
  talk_title: string;
  talk_titles: string[];
  talk_summary: string;
};

type AnnounceSnapshot = {
  event: { id: string; name: string; slug: string; starts_on: string; ends_on: string; timezone: string; venue: string | null; status: string };
  publication: { live: number; session_count: number; speaker_count: number; public_agenda_url: string };
  urls: { agenda: string; speakers: string; cfp: string };
  cfp: { url: string; status: "open" | "closed" } | null;
  announcement_copy: string | null;
  mail: { subject: string; body: string };
  embed: { source: string; snippet: string; configure_url: string } | null;
  speakers: AnnounceSpeaker[];
};

type Selection = { all: true } | { ids: string[] };

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function selectionKey(selection: Selection): string {
  return "all" in selection ? "all" : selection.ids.join(",");
}

function skipsFor(plan: DecisionPlanResponse, result: DecisionPlanApplyResult): DecisionPlanSkip[] {
  const skips = plan.rows.slice(1).flatMap((row) => row.records.map((record) => ({ id: record.id, title: record.title, reason: record.reason })));
  for (const item of result.results ?? []) {
    if (item.outcome === "succeeded") continue;
    const known = plan.rows.flatMap((row) => row.records).find((record) => record.id === item.id);
    skips.push({ id: item.id, title: known?.title ?? item.id, reason: item.error ?? "The message could not be queued." });
  }
  const seen = new Set<string>();
  return skips.filter((skip) => {
    const key = `${skip.id}:${skip.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  };
  return <Button type="button" small onClick={() => void copy()}>{copied ? "Copied" : label}</Button>;
}

export function AnnouncePage({ eventId }: { eventId: string }): JSX.Element {
  const [snapshot, setSnapshot] = useState<AnnounceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [plan, setPlan] = useState<DecisionPlanResponse | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");
  const [planStale, setPlanStale] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [result, setResult] = useState<{ plan: DecisionPlanResponse; result: DecisionPlanApplyResult; skips: DecisionPlanSkip[] } | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await apiFetch<AnnounceSnapshot>(`/api/v1/events/${encodeURIComponent(eventId)}/announce`, { route: "/api/v1/events/{eventId}/announce" });
      setSnapshot(next);
      setSubject((current) => current || next.mail.subject);
      setBody((current) => current || next.mail.body);
    } catch (caught) {
      setError(errorSummary(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [eventId]);

  const openPlan = async (nextSelection: Selection) => {
    if (!snapshot) return;
    setSelection(nextSelection);
    setPlan(null);
    setPlanError("");
    setPlanStale(false);
    setPlanLoading(true);
    try {
      const next = await apiFetch<DecisionPlanResponse>(`/api/v1/events/${encodeURIComponent(eventId)}/announce/mail-plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selector: nextSelection, subject, body }),
        route: "/api/v1/events/{eventId}/announce/mail-plan",
      });
      setPlan(next);
    } catch (caught) {
      setPlanError(errorSummary(caught));
    } finally {
      setPlanLoading(false);
    }
  };

  const applyPlan = async () => {
    if (!plan || !selection) return;
    setApplyBusy(true);
    setPlanError("");
    try {
      const next = await apiFetch<DecisionPlanApplyResult>(`/api/v1/events/${encodeURIComponent(eventId)}/announce/mail`, {
        method: "POST",
        headers: { "content-type": "application/json", "if-match": plan.etag },
        body: JSON.stringify({ selector: selection, subject, body, plan_fingerprint: plan.plan_fingerprint }),
        route: "/api/v1/events/{eventId}/announce/mail",
      });
      const skips = skipsFor(plan, next);
      if (skips.length > 0 || next.failed > 0) setResult({ plan, result: next, skips });
      setPlan(null);
      setSelection(null);
      await load();
    } catch (caught) {
      const message = errorSummary(caught);
      if (/selection or the email changed|stale/i.test(message)) setPlanStale(true);
      else setPlanError(message);
    } finally {
      setApplyBusy(false);
    }
  };

  if (loading && !snapshot) return <div class="announce-page"><PageHeader title="Announce" copy="Loading the publication-gated announcement kit." /><div class="announce-loading">Reading the live program and its public share surfaces…</div></div>;
  if (!snapshot) return <div class="announce-page"><PageHeader title="Announce" copy="Ready-to-announce assets for the public program." /><EmptyState title="Announce data unavailable" copy={error || "The conference could not be read."} action={<Button type="button" variant="primary" onClick={() => void load()}>Try again</Button>} /></div>;
  if (snapshot.publication.live === 0) return <div class="announce-page"><PageHeader title="Announce" copy="Ready-to-announce assets for the public program." /><EmptyState title="Nothing is public yet" copy="Announcing an unpublished program announces nothing. Publish at least one scheduled session from the agenda builder, then return here for truthful links and share copy." action={<Button type="button" variant="primary" onClick={() => { window.location.href = "/agenda-builder"; }}>Open agenda builder</Button>} /></div>;

  const dates = snapshot.event.starts_on === snapshot.event.ends_on ? snapshot.event.starts_on : `${snapshot.event.starts_on} – ${snapshot.event.ends_on}`;
  return <div class="announce-page">
    <PageHeader title="Announce" copy={`${snapshot.event.name} · ${dates}${snapshot.event.venue ? ` · ${snapshot.event.venue}` : ""}`} actions={<Button type="button" variant="primary" onClick={() => void openPlan({ all: true })}>Mail all their links</Button>} />
    {error ? <div class="announce-error" role="alert">{error}</div> : null}
    <div class="announce-count-strip"><span><strong>{snapshot.publication.session_count}</strong> published session{snapshot.publication.session_count === 1 ? "" : "s"}</span><span><strong>{snapshot.publication.speaker_count}</strong> public speaker{snapshot.publication.speaker_count === 1 ? "" : "s"}</span><span>Live program</span></div>
    <section class="announce-block announce-copy-block"><div class="announce-block-head"><div><span class="eyebrow">01 · Suggested copy</span><h2>Give people the public program</h2></div><CopyButton value={snapshot.announcement_copy ?? ""} label="Copy copy" /></div><textarea value={snapshot.announcement_copy ?? ""} readOnly aria-label="Suggested announcement copy" /></section>
    <section class="announce-block"><div class="announce-block-head"><div><span class="eyebrow">02 · Public links</span><h2>One address for each audience</h2></div></div><div class="announce-link-list"><AnnounceLink label="Conference site" href={snapshot.urls.agenda} /><AnnounceLink label="Speakers directory" href={snapshot.urls.speakers} />{snapshot.cfp ? <AnnounceLink label={`Call for speakers · ${snapshot.cfp.status}`} href={snapshot.cfp.url} /> : <div class="announce-link-row"><span>Call for speakers</span><span class="announce-muted">No public call is configured</span></div>}</div></section>
    {snapshot.embed ? <section class="announce-block"><div class="announce-block-head"><div><span class="eyebrow">03 · Canonical embed</span><h2>Put the program on another site</h2></div><a class="announce-text-link" href={snapshot.embed.configure_url}>Configure formats</a></div><textarea class="announce-code" value={snapshot.embed.snippet} readOnly aria-label="Canonical agenda embed snippet" /></section> : null}
    <section class="announce-block announce-unfurl"><div class="announce-block-head"><div><span class="eyebrow">04 · Pasted links</span><h2>How the public link renders</h2></div></div><div class="announce-unfurl-grid"><img src="/marquee-share-card.svg" alt="Event-branded Marquee share card" /><div><p>Every speaker link opens the published public page and carries this event-branded share card when it is pasted into a social post or message.</p><a class="announce-text-link" href={snapshot.urls.agenda}>Open the public program</a></div></div></section>
    <section class="announce-block announce-speakers"><div class="announce-block-head"><div><span class="eyebrow">05 · Speaker links</span><h2>Ready for speakers to share</h2></div><Button type="button" onClick={() => void openPlan({ all: true })}>Mail all their links</Button></div><div class="announce-mail-copy"><label>Mail subject<input value={subject} onInput={(event) => setSubject(event.currentTarget.value)} /></label><label>Mail body<textarea value={body} onInput={(event) => setBody(event.currentTarget.value)} /></label></div><div class="announce-speaker-list">{snapshot.speakers.map((speaker) => <article class="announce-speaker-row" key={speaker.id}><div class="announce-speaker-copy"><strong>{speaker.name}</strong><span>{speaker.talk_title}</span><p>{speaker.talk_summary}</p><a href={speaker.public_link}>{speaker.public_link}</a>{speaker.talk_titles.length > 1 ? <small>{speaker.talk_titles.length} published talks</small> : null}</div><div class="announce-speaker-actions"><CopyButton value={speaker.public_link} label="Copy" /><Button type="button" small onClick={() => void openPlan({ ids: [speaker.id] })}>Mail it</Button>{speaker.do_not_contact ? <Chip tone="warning">Do not contact</Chip> : !speaker.email ? <Chip tone="warning">No address</Chip> : null}</div></article>)}</div></section>
    {(plan || planLoading || planError || planStale) ? <DecisionPlanPanel plan={plan} loading={planLoading} error={planError} stale={planStale} busy={applyBusy} feedback="" internalNote="" confirmPublished={false} publishedCount={null} onFeedbackChange={() => undefined} onInternalNoteChange={() => undefined} onConfirmPublishedChange={() => undefined} onConfirm={() => void applyPlan()} onClose={() => { setPlan(null); setSelection(null); }} onRefresh={() => { if (selection) void openPlan(selection); }} /> : null}
    {result ? <DecisionPlanResultModal plan={result.plan} result={result.result} skips={result.skips} onClose={() => setResult(null)} /> : null}
  </div>;
}

function AnnounceLink({ label, href }: { label: string; href: string }): JSX.Element {
  return <div class="announce-link-row"><span>{label}</span><a href={href}>{href}</a><CopyButton value={href} /></div>;
}
