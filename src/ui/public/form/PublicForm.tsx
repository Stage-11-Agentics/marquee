/** @jsxImportSource preact */

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { isFieldApplicable, projectApplicableAnswers } from "../../../lib/form-conditions";
import { putFileToR2 } from "../../upload/upload-client";
import type { PublicFormField, PublicFormState } from "../../../routes/public-form.types";

interface PublicFormProps {
  initial: PublicFormState;
}

interface ApiErrorPayload {
  error?: { message?: string; details?: { issues?: Array<{ fieldKey?: string; message?: string }> } };
}

function optionsFor(field: PublicFormField): string[] {
  return Array.isArray(field.config.options)
    ? field.config.options.filter((option): option is string => typeof option === "string")
    : [];
}

function maxLengthFor(field: PublicFormField): number | undefined {
  return typeof field.config.maxLength === "number" && Number.isFinite(field.config.maxLength)
    ? Math.max(0, Math.floor(field.config.maxLength))
    : undefined;
}

function closeLabel(closesAt: number | null): string {
  if (!closesAt) return "Call for speakers";
  return `Call for speakers · closes ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(closesAt))}`;
}

function answerEmail(answers: Record<string, unknown>): string {
  return typeof answers.speaker_email === "string" ? answers.speaker_email : "";
}

function publicIssueMessage(issue: { message: string }): string {
  const message = issue.message.toLowerCase();
  if (message.includes("required")) return "Add an answer so the conference team can review this abstract.";
  if (message.includes("email")) return "Enter an address where the conference team can reach you, then try again.";
  if (message.includes("url")) return "Add a web address beginning with https://, then try again.";
  if (message.includes("number")) return "Enter a number in the range shown, then try again.";
  if (message.includes("option")) return "Choose an option from the list, then try again.";
  if (message.includes("file")) return "Choose a file of the accepted size and format, then try again.";
  if (message.includes("characters")) return `${issue.message} Then try again.`;
  return "Add the requested detail, then try again.";
}

function errorMessageFor(response: Response, payload: ApiErrorPayload | null): string {
  const issues = payload?.error?.details?.issues ?? [];
  if (issues.length > 0) return issues[0]?.message ?? "Add the requested detail, then try again.";
  if (response.status === 403 && payload?.error?.message?.toLowerCase().includes("resume")) return "Use the resume link from your email, then try again; your answers are still here.";
  if (response.status === 403) return "We could not verify the security check. Complete it, then choose Submit again; your answers are still here.";
  if (response.status === 429) return "This form needs a short pause before another try. Wait a moment, then choose Submit again; your draft is saved.";
  if (response.status >= 500) return "The conference could not save this submission. Your answers are saved here; try Submit again in a moment.";
  if (response.status === 409) return "The conference cannot accept this submission right now. Keep your answers here, then try again after following the message above.";
  if (response.status === 404) return "This conference form is no longer available. Return to the conference page and choose the form again.";
  return "We could not save this change. Your answers are still here; check the details and try again.";
}

async function readPayload(response: Response): Promise<ApiErrorPayload | PublicFormState | null> {
  try { return await response.json() as ApiErrorPayload | PublicFormState; } catch { return null; }
}

export function PublicForm({ initial }: PublicFormProps) {
  const [state, setState] = useState(initial);
  const [answers, setAnswers] = useState<Record<string, unknown>>(initial.answers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [dirty, setDirty] = useState(false);
  const firstRender = useRef(true);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  function resetTurnstile() {
    setTurnstileToken("");
    (window as unknown as { turnstile?: { reset?: () => void } }).turnstile?.reset?.();
  }

  const visibleFields = useMemo(
    () => state.fields.filter((field) => isFieldApplicable(field, answers)),
    [state.fields, answers],
  );

  useEffect(() => {
    (window as unknown as { marqueeTurnstileCallback?: (token: string) => void }).marqueeTurnstileCallback = setTurnstileToken;
    if (!state.turnstile_site_key || typeof document === "undefined") return;
    if (document.querySelector("script[data-public-turnstile]")) return;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.publicTurnstile = "true";
    document.head.appendChild(script);
  }, [state.turnstile_site_key]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!dirty || !state.resume_token || state.state === "submitted") return;
    const timer = window.setTimeout(() => { void autosave(); }, 750);
    return () => window.clearTimeout(timer);
  }, [answers, dirty, state.resume_token, state.state]);

  function setAnswer(key: string, value: unknown) {
    setAnswers((current) => ({ ...current, [key]: value }));
    setErrors((current) => { const next = { ...current }; delete next[key]; return next; });
    setDirty(true);
    setPageError(null);
  }

  function validate(): boolean {
    const result = projectApplicableAnswers(state.fields, answers);
    const next: Record<string, string> = {};
    for (const issue of result.issues) next[issue.fieldKey] = publicIssueMessage(issue);
    setErrors(next);
    const first = visibleFields.find((field) => next[field.key]);
    if (first) {
      window.setTimeout(() => fieldRefs.current[first.key]?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return false;
    }
    return true;
  }

  async function ensureDraft(): Promise<PublicFormState | null> {
    if (state.resume_token && state.draft_id) return state;
    const email = answerEmail(answers);
    if (!email) {
      setPageError("Enter your contact address before saving a draft; the conference team uses it for your resume link.");
      const field = fieldRefs.current.speaker_email;
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
      return null;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/public/forms/${encodeURIComponent(state.form.slug)}/drafts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers, email, turnstileToken: turnstileToken || undefined }),
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload || !("state" in payload)) {
        resetTurnstile();
        setPageError(errorMessageFor(response, payload && "error" in payload ? payload : null));
        return null;
      }
      setState(payload);
      setAnswers(payload.answers);
      setDirty(false);
      resetTurnstile();
      return payload;
    } catch {
      resetTurnstile();
      setPageError("The conference could not save this draft. Your answers are still here; try again in a moment.");
      return null;
    } finally { setBusy(false); }
  }

  async function autosave() {
    if (!state.resume_token || !state.draft_id || busy) return;
    try {
      const response = await fetch(`/api/v1/public/forms/${encodeURIComponent(state.form.slug)}/drafts/${encodeURIComponent(state.resume_token)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers }),
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload || !("state" in payload)) {
        setTurnstileToken("");
        setPageError(errorMessageFor(response, payload && "error" in payload ? payload : null));
        return;
      }
      setState(payload);
      setAnswers(payload.answers);
      setDirty(false);
    } catch {
      setPageError("The conference could not save this draft. Your answers are still here; try again in a moment.");
    }
  }

  async function handleFile(field: PublicFormField, file: File | undefined) {
    if (!file) return;
    setPageError(null);
    const hadDraft = Boolean(state.resume_token && state.draft_id);
    const draftState = await ensureDraft();
    if (!draftState?.resume_token || !draftState.draft_id) return;
    if (!hadDraft) {
      resetTurnstile();
      setPageError("Your draft is saved. Complete the security check again, then choose the file once more.");
      return;
    }
    setBusy(true);
    try {
      const signResponse = await fetch("/api/v1/public/uploads/sign", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draftState.draft_id, resumeToken: draftState.resume_token, fieldKey: field.key, turnstileToken: turnstileToken || undefined, filename: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size }),
      });
      const signed = await signResponse.json() as { attachmentId?: string; completionToken?: string; putUrl?: string; requiredHeaders?: Record<string, string> };
      if (!signResponse.ok || !signed.attachmentId || !signed.completionToken || !signed.putUrl) {
        resetTurnstile();
        setPageError(errorMessageFor(signResponse, signed as ApiErrorPayload));
        return;
      }
      await putFileToR2({ putUrl: signed.putUrl, requiredHeaders: signed.requiredHeaders ?? {}, expiresAt: Date.now() + 60_000, completionToken: signed.completionToken, attachmentId: signed.attachmentId, maxBytes: Number.MAX_SAFE_INTEGER }, file).promise;
      const complete = await fetch(`/api/v1/public/uploads/${encodeURIComponent(signed.attachmentId)}/complete`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ completionToken: signed.completionToken }),
      });
      if (!complete.ok) { resetTurnstile(); setPageError("The conference could not finish that upload. Keep the file selected and try again."); return; }
      resetTurnstile();
      setAnswer(field.key, { attachmentId: signed.attachmentId, filename: file.name, contentType: file.type, sizeBytes: file.size });
    } catch {
      resetTurnstile();
      setPageError("The conference could not finish that upload. Keep the file selected and try again.");
    } finally { setBusy(false); }
  }

  async function submit(event: Event) {
    event.preventDefault();
    setPageError(null);
    if (!validate()) {
      setPageError("Add the highlighted details, then choose Submit again. Your answers are still here.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/public/forms/${encodeURIComponent(state.form.slug)}/submissions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers, resumeToken: state.resume_token ?? undefined, turnstileToken: turnstileToken || undefined }),
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload || !("state" in payload)) {
        resetTurnstile();
        const issues = payload && "error" in payload ? payload.error?.details?.issues ?? [] : [];
        if (issues.length) {
          const next: Record<string, string> = {};
          for (const issue of issues) if (issue.fieldKey && issue.message) next[issue.fieldKey] = issue.message;
          setErrors(next);
        }
        setPageError(errorMessageFor(response, payload && "error" in payload ? payload : null));
        return;
      }
      setState(payload);
      setAnswers(payload.answers);
      setDirty(false);
      resetTurnstile();
    } catch {
      resetTurnstile();
      setPageError("The conference could not save this submission. Your answers are saved here; try Submit again in a moment.");
    } finally { setBusy(false); }
  }

  function renderField(field: PublicFormField) {
    const value = answers[field.key];
    const error = errors[field.key];
    const ref = (node: HTMLElement | null) => { fieldRefs.current[field.key] = node; };
    const options = optionsFor(field);
    const maxLength = maxLengthFor(field);
    const characterCount = typeof value === "string" ? value.length : 0;
    const label = <label for={`public-${field.key}`}>{field.label} {field.required ? <em>required</em> : <em>optional</em>}</label>;
    const note = field.help_text ? <div class="public-field-note">{field.help_text}</div> : null;
    const counter = maxLength !== undefined ? <div class="public-field-counter" aria-live="polite">{characterCount}/{maxLength} characters</div> : null;
    let control;
    if (field.type === "long_text") {
      control = <textarea id={`public-${field.key}`} ref={ref as never} maxLength={maxLength} value={typeof value === "string" ? value : ""} onBlur={() => { if (dirty) validate(); }} onInput={(event) => setAnswer(field.key, (event.currentTarget as HTMLTextAreaElement).value)} aria-invalid={Boolean(error)} />;
    } else if (field.type === "single_select") {
      control = <select id={`public-${field.key}`} ref={ref as never} value={typeof value === "string" ? value : ""} onChange={(event) => setAnswer(field.key, (event.currentTarget as HTMLSelectElement).value)} aria-invalid={Boolean(error)}><option value="">Choose one</option>{options.map((option) => <option value={option}>{option}</option>)}</select>;
    } else if (field.type === "multi_select") {
      const selected = Array.isArray(value) ? value : [];
      control = <div class="public-option-list" ref={ref as never}>{options.map((option) => <label class="public-option"><input type="checkbox" checked={selected.includes(option)} onChange={(event) => { const next = (event.currentTarget as HTMLInputElement).checked ? [...selected, option] : selected.filter((item) => item !== option); setAnswer(field.key, next); }} />{option}</label>)}</div>;
    } else if (field.type === "file") {
      const existing = typeof value === "object" && value !== null && "filename" in value ? String((value as { filename: unknown }).filename) : null;
      const accept = Array.isArray(field.config.accept) ? field.config.accept.join(",") : undefined;
      control = <div class="public-file"><input id={`public-${field.key}`} ref={ref as never} type="file" accept={accept} onChange={(event) => { void handleFile(field, (event.currentTarget as HTMLInputElement).files?.[0]); }} />{existing && <span class="public-file-existing">Saved file: {existing}</span>}</div>;
    } else {
      const inputType = field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "number" ? "number" : "text";
      control = <input id={`public-${field.key}`} ref={ref as never} type={inputType} maxLength={maxLength} value={value === undefined || value === null ? "" : String(value)} onBlur={() => { if (dirty) validate(); }} onInput={(event) => { const text = (event.currentTarget as HTMLInputElement).value; setAnswer(field.key, field.type === "number" && text ? Number(text) : text); }} aria-invalid={Boolean(error)} />;
    }
    return <div class={`public-field${error ? " has-error" : ""}`} data-field-key={field.key} key={field.key}>{label}{note}{control}{counter}{error && <div class="public-field-error" role="alert">{error}</div>}</div>;
  }

  const closed = state.state === "closed" || state.state === "at_limit" || state.state === "submitted";
  if (state.state === "submitted" && state.confirmation) {
    return <div class="public-form"><PublicHeader state={state} /><main class="public-form-main"><section class="public-confirmation" aria-live="polite"><div class="public-brand-mark">✓</div><h2>{state.confirmation.title}</h2><p>{state.confirmation.message}</p><p>We will write to <strong>{state.confirmation.email}</strong>.</p>{state.resume_url && <p><a href={state.resume_url}>Keep your abstract link</a></p>}{state.confirmation.portal_url && <p><a href={state.confirmation.portal_url}>Open your speaker portal →</a></p>}</section></main><PublicFooter /></div>;
  }

  const minimumParticipants = state.form.min_speakers === 1 ? "one participant" : `${state.form.min_speakers} participants`;
  const maximumParticipants = state.form.max_speakers === 1 ? "one participant" : `${state.form.max_speakers} participants`;
  return <div class="public-form"><PublicHeader state={state} /><main class="public-form-main"><section class="public-intro"><h1>{state.form.name}</h1><p>{state.form.welcome_md || "Share the idea you want the conference to make room for."}</p><div class="public-meta"><span>{state.conference.name}</span>{state.form.closes_at && <span>Closes {new Date(state.form.closes_at).toLocaleDateString()}</span>}<span class="public-save-status" aria-live="polite">{state.resume_token ? (dirty ? "Saving…" : state.last_saved_at ? `Saved ${new Date(state.last_saved_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Draft linked") : "Draft saved locally · just now"}</span></div><div class="public-progress" aria-label="Form progress">{[0, 1, 2, 3, 4].map((step) => <i class={step <= Math.min(4, Math.floor(Object.keys(answers).length / Math.max(1, state.fields.length) * 5)) ? "is-active" : ""} />)}</div></section>{state.message && <div class={`public-notice${closed && state.state !== "submitted" ? " alarm" : ""}`} role="status">{state.message}</div>}{pageError && <div class="public-error" role="alert">{pageError}</div>}<form class="public-form-card" onSubmit={submit}><div class="public-form-card-head"><h2>Abstract details</h2><span class="public-kicker">{visibleFields.length} answers</span></div><p class="public-participant-limit">Include at least {minimumParticipants}; this conference can review up to {maximumParticipants} on one abstract.</p><div class="public-form-fields">{visibleFields.map(renderField)}<div class="public-security"><div class="cf-turnstile" data-sitekey={state.turnstile_site_key ?? ""} data-callback="marqueeTurnstileCallback" /><input type="hidden" data-turnstile-token value={turnstileToken} /></div></div><div class="public-form-footer"><span class="public-security">Your answers stay here while you work. A resume link goes to the address you enter.</span><button class="public-submit" type="submit" disabled={busy || closed}>{busy ? "Saving…" : "Submit abstract"}</button></div></form></main><PublicFooter /></div>;
}

function PublicHeader({ state }: { state: PublicFormState }) {
  return <header class="public-form-header"><div class="public-form-header-inner"><a class="public-brand" href="/"><span class="public-brand-mark">M</span><span class="public-brand-name">Marquee</span></a><span class="public-kicker">{state.conference.name}<br />{closeLabel(state.form.closes_at)}</span></div></header>;
}

function PublicFooter() {
  return <footer class="public-footer"><span>Marquee · conference program operations</span><span>Your response is saved with the conference</span></footer>;
}
