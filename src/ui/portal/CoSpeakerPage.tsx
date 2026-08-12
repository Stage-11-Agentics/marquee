/** @jsxImportSource preact */

import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { SignedUpload } from "../../lib/r2/protocol";
import { apiFetch } from "../shell/api-client";
import { putFileToR2 } from "../upload/upload-client";
import "./portal.css";

type ApiFailure = Error & { status?: number };

type CoSpeakerState = {
  submission: {
    id: string;
    title: string;
    abstract: string | null;
    status: string;
    updated_at: number;
  };
  participation: {
    id: string;
    role: string;
    confirmation_status: "pending" | "confirmed" | "declined";
    confirmed_at: number | null;
  };
  person: {
    id: string;
    name: string;
    email: string;
    bio: string | null;
    headshot_attachment_id: string | null;
    updated_at: number;
  };
};

/** The co-speaker surface's one API call, through the shared client. */
async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
}

function statusLabel(status: CoSpeakerState["participation"]["confirmation_status"]): string {
  if (status === "confirmed") return "Role confirmed";
  if (status === "declined") return "Role declined";
  return "Response needed";
}

export function CoSpeakerPage(): JSX.Element {
  const submissionId = new URLSearchParams(window.location.search).get("submission");
  const [state, setState] = useState<CoSpeakerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [bio, setBio] = useState("");
  const [headshotId, setHeadshotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const refresh = async () => {
    if (!submissionId) {
      setError(Object.assign(new Error("This invitation is incomplete. Ask the conference team to send it again."), { status: 404 }));
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const next = await requestJson<CoSpeakerState>(`/api/v1/me/co-speaker/submissions/${encodeURIComponent(submissionId)}`);
      setState(next);
      setBio(next.person.bio ?? "");
      setHeadshotId(next.person.headshot_attachment_id);
    } catch (caught) {
      setError(caught as ApiFailure);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [submissionId]);

  async function saveProfile(event: Event) {
    event.preventDefault();
    if (!submissionId) return;
    try {
      setBusy(true);
      setSaveMessage(null);
      const next = await requestJson<CoSpeakerState>(`/api/v1/me/co-speaker/submissions/${encodeURIComponent(submissionId)}/profile`, {
        method: "PATCH",
        body: JSON.stringify({ bio: bio || null, headshot_attachment_id: headshotId }),
      });
      setState(next);
      setBio(next.person.bio ?? "");
      setHeadshotId(next.person.headshot_attachment_id);
      setSaveMessage("Your profile is saved for this abstract.");
    } catch (caught) {
      setSaveMessage((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadHeadshot(file: File | undefined) {
    if (!file || !state) return;
    try {
      setUploading(true);
      setSaveMessage(null);
      const signed = await requestJson<SignedUpload>("/api/v1/me/uploads/sign", {
        method: "POST",
        body: JSON.stringify({ ownerType: "person_headshot", ownerId: state.person.id, filename: file.name, contentType: file.type, sizeBytes: file.size }),
      });
      await putFileToR2(signed, file).promise;
      const completed = await requestJson<{ attachmentId: string }>(`/api/v1/me/uploads/${encodeURIComponent(signed.attachmentId)}/complete`, {
        method: "POST",
        body: JSON.stringify({ completionToken: signed.completionToken }),
      });
      setHeadshotId(completed.attachmentId);
      setSaveMessage("Headshot uploaded. Choose Save profile to attach it to this abstract.");
    } catch (caught) {
      setSaveMessage((caught as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function respond(response: "confirm" | "decline") {
    if (!state) return;
    try {
      setBusy(true);
      setSaveMessage(null);
      await requestJson(`/api/v1/me/participations/${encodeURIComponent(state.participation.id)}/${response}`, {
        method: "POST",
        body: response === "decline" ? JSON.stringify({}) : undefined,
      });
      await refresh();
    } catch (caught) {
      setSaveMessage((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <CoSpeakerFrame><div class="portal-loading">Loading your conference invitation…</div></CoSpeakerFrame>;
  if (error || !state) {
    const expired = error?.status === 401;
    return <CoSpeakerFrame><div class="portal-error"><div><strong>{expired ? "This invitation needs a fresh sign-in." : "We could not open this invitation."}</strong><p>{expired ? "Sign in and this invitation opens again — or ask the conference team to send a new profile link." : error?.message ?? "Ask the conference team to send the invitation again."}</p><a class="portal-signin" href={expired ? "/signin" : "/"}>{expired ? "Sign in" : "Return to conference"}</a></div></div></CoSpeakerFrame>;
  }

  const responseStatus = state.participation.confirmation_status;
  const canRespond = state.submission.status === "accepted" && responseStatus === "pending";
  return <CoSpeakerFrame>
    <main class="portal-main">
      <section class="portal-status-hero" aria-labelledby="co-speaker-heading">
        <span class="eyebrow">Co-speaker invitation</span>
        <h1 id="co-speaker-heading">You’re joining “{state.submission.title}”</h1>
        <div class="portal-status-copy">This page is limited to this abstract. Your talk title and abstract are read-only here.</div>
      </section>
      <div class="portal-grid">
        <section class="portal-panel" aria-labelledby="abstract-heading">
          <header class="portal-panel-head"><h2 id="abstract-heading">Abstract</h2><span>{state.submission.status}</span></header>
          <div class="portal-panel-body"><h3>{state.submission.title}</h3><p class="portal-talk-description">{state.submission.abstract || "The abstract has no description yet."}</p><div class="portal-role-responses"><div class="portal-role-responses-head"><span>Your role</span><small>{statusLabel(responseStatus)}</small></div>{canRespond ? <div class="portal-role-action-buttons"><button class="portal-button" type="button" disabled={busy} onClick={() => void respond("confirm")}>Confirm role</button><button class="portal-role-decline" type="button" disabled={busy} onClick={() => void respond("decline")}>Decline</button></div> : <span class={`portal-role-status ${responseStatus}`}>{responseStatus === "pending" ? "The conference team will ask for your response after accepting this abstract." : statusLabel(responseStatus)}</span>}</div></div>
        </section>
        <section class="portal-panel" aria-labelledby="profile-heading">
          <header class="portal-panel-head"><h2 id="profile-heading">Your profile</h2><span>{state.person.email}</span></header>
          <div class="portal-panel-body"><form class="portal-profile" onSubmit={saveProfile}><div class="portal-avatar-line"><div class="portal-avatar">{state.person.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</div><div class="portal-avatar-copy"><strong>{state.person.name}</strong><span>Only your bio and headshot are editable on this page.</span></div></div><div class="portal-field full"><label for="co-speaker-bio">Bio</label><textarea id="co-speaker-bio" value={bio} onInput={(event) => setBio((event.currentTarget as HTMLTextAreaElement).value)} placeholder="Share the introduction the conference team should use." /></div><div class="portal-field full"><label for="co-speaker-headshot">Headshot</label><input id="co-speaker-headshot" type="file" accept="image/*" disabled={uploading} onChange={(event) => { void uploadHeadshot((event.currentTarget as HTMLInputElement).files?.[0]); }} /><small class="portal-crop-note">{headshotId ? "A headshot is ready to attach." : "Choose an image, then save your profile."}</small></div><div class="portal-payload-actions"><span class="portal-payload-error" aria-live="polite">{saveMessage ?? " "}</span><button class="portal-button" type="submit" disabled={busy || uploading}>{busy ? "Saving…" : "Save profile"}</button></div></form></div>
        </section>
      </div>
      <p><a class="portal-signin" href="/">Return to conference</a></p>
    </main>
  </CoSpeakerFrame>;
}

function CoSpeakerFrame({ children }: { children: JSX.Element }): JSX.Element {
  return <div class="portal-shell"><header class="portal-top"><span class="portal-brand">Marquee · Conference profile</span><button type="button" onClick={async () => { await requestJson("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined); window.location.assign("/"); }}>Sign out</button></header>{children}</div>;
}

export default CoSpeakerPage;
