/** @jsxImportSource preact */

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { isFieldApplicable, projectApplicableAnswers } from "../../../lib/form-conditions";
import { putFileToR2 } from "../../upload/upload-client";
import { apiFetch, errorSummary, MarqueeApiError } from "../../shell/api-client";
import type { PublicFormField, PublicFormState } from "../../../routes/public-form.types";
import { removeTurnstileWidget, renderTurnstileWidget, resetTurnstileWidget, type TurnstileApi } from "./turnstile";

interface PublicFormProps {
  initial: PublicFormState;
}

interface TurnstileGlobals {
  turnstile?: TurnstileApi;
  marqueeTurnstileCallback?: (token: string) => void;
  marqueeTurnstileReady?: () => void;
}

const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=marqueeTurnstileReady";

/** A managed widget can ask the person to click; give them room before giving up. */
const TURNSTILE_WAIT_MS = 20_000;

const SECURITY_CHECK_UNFINISHED = "The security check did not finish. Complete it at the bottom of this form, then try again; your answers are still here.";

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

function closeLabel(state: PublicFormState): string {
  // A closed call must not still advertise a future closing date; the header
  // is the first thing read and the last thing anyone re-reads.
  if (state.state === "closed") return "Call for speakers · closed";
  if (state.state === "at_limit") return "Call for speakers · your limit is full";
  const closesAt = state.form.closes_at;
  if (!closesAt) return "Call for speakers";
  return `Call for speakers · closes ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(closesAt))}`;
}

function answerEmail(answers: Record<string, unknown>): string {
  return typeof answers.speaker_email === "string" ? answers.speaker_email : "";
}

/**
 * The confirmation renders the resume link as a same-origin path.
 *
 * `resume_url` is absolute because the identical string is emailed, and under
 * `wrangler dev` its origin is the deployed host rather than the loopback
 * listener (the request rewrite documented in src/lib/cookies.ts). Following an
 * absolute href from a local run therefore leaves the machine being validated
 * and lands on a form that has never seen the token — which renders as the
 * blank call for speakers. Deployed, the two forms are the same URL.
 */
function resumeLinkPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function publicIssueMessage(issue: { message: string }): string {
  const message = issue.message.toLowerCase();
  if (message.includes("required")) return "Add an answer so the conference team can review this abstract.";
  if (message.includes("email")) return "Enter an address where the conference team can reach you, then try again.";
  if (message.includes("url")) return "Add a web address beginning with https://, then try again.";
  if (message.includes("number")) return "Enter a number in the range shown, then try again.";
  if (message.includes("date")) return "Choose a valid date, then try again.";
  if (message.includes("option")) return "Choose an option from the list, then try again.";
  if (message.includes("file")) return "Choose a file of the accepted size and format, then try again.";
  if (message.includes("characters")) return `${issue.message} Then try again.`;
  return "Add the requested detail, then try again.";
}

function publicErrorMessage(error: unknown): string {
  if (!(error instanceof MarqueeApiError)) return errorSummary(error);
  const message = error.message.toLowerCase();
  let sentence: string;
  if (error.status === 403 && message.includes("resume")) sentence = "Use the resume link from your email, then try again; your answers are still here.";
  else if (error.status === 403) sentence = "We could not verify the security check. Complete it, then choose Submit again; your answers are still here.";
  else if (error.status === 429) sentence = "This form needs a short pause before another try. Wait a moment, then choose Submit again; your draft is saved.";
  else if (error.status >= 500) sentence = "The conference could not save this submission. Your answers are saved here; try Submit again in a moment.";
  else if (error.status === 409) sentence = "The conference cannot accept this submission right now. Keep your answers here, then try again after following the message above.";
  else if (error.status === 404) sentence = "This conference form is no longer available. Return to the conference page and choose the form again.";
  else return errorSummary(error);
  return `${sentence} · ref ${error.reference}`;
}

function publicValidationIssues(error: unknown): Array<{ fieldKey?: string; message?: string }> {
  if (!(error instanceof MarqueeApiError) || typeof error.details !== "object" || error.details === null) return [];
  const issues = (error.details as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter((issue): issue is { fieldKey?: string; message?: string } => {
    if (typeof issue !== "object" || issue === null) return false;
    const candidate = issue as { fieldKey?: unknown; message?: unknown };
    return (candidate.fieldKey === undefined || typeof candidate.fieldKey === "string")
      && (candidate.message === undefined || typeof candidate.message === "string");
  });
}

export function PublicForm({ initial }: PublicFormProps) {
  const [state, setState] = useState(initial);
  const [answers, setAnswers] = useState<Record<string, unknown>>(initial.answers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [dirty, setDirty] = useState(false);
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const [draftEmailPrompt, setDraftEmailPrompt] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const firstRender = useRef(true);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const draftEmailRef = useRef<HTMLInputElement | null>(null);
  const turnstileHost = useRef<HTMLElement | null>(null);
  const turnstileWidget = useRef<string | null>(null);
  const turnstileTokenRef = useRef("");
  const turnstileWaiters = useRef<Array<(token: string) => void>>([]);
  const previewUrls = useRef<Record<string, string>>({});

  function receiveTurnstileToken(token: string) {
    turnstileTokenRef.current = token;
    setTurnstileToken(token);
    if (!token) return;
    const waiting = turnstileWaiters.current;
    turnstileWaiters.current = [];
    for (const resolve of waiting) resolve(token);
  }

  /** Clears the spent token and asks the widget for the next one. Never throws. */
  function resetTurnstile() {
    turnstileTokenRef.current = "";
    setTurnstileToken("");
    resetTurnstileWidget((window as unknown as TurnstileGlobals).turnstile, turnstileWidget.current);
  }

  /**
   * Retire the widget for good. A submitted form replaces the whole tree with
   * the confirmation, taking the container with it, and Cloudflare warns about
   * a widget whose container vanished underneath it — so remove it first,
   * while it is still there to remove.
   */
  function removeTurnstile() {
    turnstileTokenRef.current = "";
    setTurnstileToken("");
    const widget = turnstileWidget.current;
    turnstileWidget.current = null;
    removeTurnstileWidget((window as unknown as TurnstileGlobals).turnstile, widget);
  }

  /**
   * A Turnstile token is single-use: the server records each one it verifies,
   * so creating the draft spends the token the upload presign then needs. Ask
   * the widget for the next one and wait for it rather than sending the person
   * back to re-pick the same file.
   */
  function requestTurnstileToken(): Promise<string | undefined> {
    if (turnstileTokenRef.current) return Promise.resolve(turnstileTokenRef.current);
    if (!turnstileWidget.current) return Promise.resolve(undefined);
    resetTurnstile();
    return new Promise((resolve) => {
      let timer = 0;
      const waiter = (token: string) => {
        window.clearTimeout(timer);
        resolve(token);
      };
      timer = window.setTimeout(() => {
        turnstileWaiters.current = turnstileWaiters.current.filter((entry) => entry !== waiter);
        resolve(undefined);
      }, TURNSTILE_WAIT_MS);
      turnstileWaiters.current = [...turnstileWaiters.current, waiter];
    });
  }

  /** True once a widget is mounted, i.e. once a token is genuinely obtainable. */
  function turnstileRequired(): boolean {
    return Boolean(turnstileWidget.current);
  }

  const visibleFields = useMemo(
    () => state.fields.filter((field) => isFieldApplicable(field, answers)),
    [state.fields, answers],
  );

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const globals = window as unknown as TurnstileGlobals;
    globals.marqueeTurnstileCallback = receiveTurnstileToken;
    const siteKey = state.turnstile_site_key;
    if (!siteKey) return;
    let cancelled = false;
    const mount = () => {
      if (cancelled || turnstileWidget.current) return;
      turnstileWidget.current = renderTurnstileWidget(globals.turnstile, turnstileHost.current, {
        sitekey: siteKey,
        onToken: receiveTurnstileToken,
      });
    };
    globals.marqueeTurnstileReady = mount;
    mount();
    if (!document.querySelector("script[data-public-turnstile]")) {
      const script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.dataset.publicTurnstile = "true";
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      const widget = turnstileWidget.current;
      turnstileWidget.current = null;
      removeTurnstileWidget(globals.turnstile, widget);
    };
  }, [state.turnstile_site_key]);

  useEffect(() => () => {
    for (const url of Object.values(previewUrls.current)) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    const settleFocusedField = () => {
      const target = document.activeElement;
      if (!(target instanceof HTMLElement) || !target.matches("input, textarea, select, button")) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const box = target.getBoundingClientRect();
      if (box.top < top + 12 || box.bottom > bottom - 12) {
        target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      }
    };
    const onFocus = () => window.requestAnimationFrame(settleFocusedField);
    const onViewportResize = () => window.requestAnimationFrame(settleFocusedField);
    document.addEventListener("focusin", onFocus);
    window.visualViewport?.addEventListener("resize", onViewportResize);
    return () => {
      document.removeEventListener("focusin", onFocus);
      window.visualViewport?.removeEventListener("resize", onViewportResize);
    };
  }, []);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-public-form]");
    if (!root) return;
    const measureOverflow = () => {
      root.toggleAttribute("data-horizontal-overflow", root.scrollWidth > root.clientWidth);
    };
    measureOverflow();
    window.addEventListener("resize", measureOverflow);
    window.visualViewport?.addEventListener("resize", measureOverflow);
    return () => {
      window.removeEventListener("resize", measureOverflow);
      window.visualViewport?.removeEventListener("resize", measureOverflow);
    };
  }, []);

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
      setDraftEmailPrompt(true);
      setPageError(null);
      window.setTimeout(() => draftEmailRef.current?.focus(), 0);
      return null;
    }
    setDraftEmailPrompt(false);
    setBusy(true);
    try {
      const token = await requestTurnstileToken();
      if (turnstileRequired() && !token) {
        setPageError(SECURITY_CHECK_UNFINISHED);
        return null;
      }
      const payload = await apiFetch<PublicFormState>(`/api/v1/public/forms/${encodeURIComponent(state.form.slug)}/drafts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers, email, turnstileToken: token }),
        route: "/api/v1/public/forms/{slug}/drafts",
      });
      if (!payload || !("state" in payload)) throw new Error("The draft response was unreadable.");
      setState(payload);
      setAnswers(payload.answers);
      setDirty(false);
      resetTurnstile();
      return payload;
    } catch (error: unknown) {
      resetTurnstile();
      setPageError(publicErrorMessage(error));
      return null;
    } finally { setBusy(false); }
  }

  async function saveDraft() {
    setPageError(null);
    if (state.resume_token && state.draft_id) {
      await autosave();
      return;
    }
    await ensureDraft();
  }

  async function autosave() {
    if (!state.resume_token || !state.draft_id || busy) return;
    try {
      const payload = await apiFetch<PublicFormState>(`/api/v1/public/forms/${encodeURIComponent(state.form.slug)}/drafts/${encodeURIComponent(state.resume_token)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers }),
        route: "/api/v1/public/forms/{slug}/drafts/{token}",
      });
      if (!payload || !("state" in payload)) throw new Error("The autosave response was unreadable.");
      setState(payload);
      setAnswers(payload.answers);
      setDirty(false);
    } catch (error: unknown) {
      resetTurnstile();
      setPageError(publicErrorMessage(error));
    }
  }

  async function copyResumeLink() {
    if (!state.resume_url) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(state.resume_url);
      } else {
        const input = document.createElement("textarea");
        input.value = state.resume_url;
        input.setAttribute("readonly", "true");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("Clipboard copy was not available.");
      }
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2500);
    } catch {
      setCopyState("failed");
    }
  }

  /**
   * Show the chosen image immediately, before any network work — the field
   * label promises a crop preview before submission, and the person deserves
   * to see what they picked whether or not the upload then succeeds.
   */
  function showLocalPreview(field: PublicFormField, file: File) {
    if (typeof URL?.createObjectURL !== "function" || !file.type.startsWith("image/")) return;
    const previous = previewUrls.current[field.key];
    previewUrls.current = { ...previewUrls.current, [field.key]: URL.createObjectURL(file) };
    setFilePreviews(previewUrls.current);
    if (previous) URL.revokeObjectURL(previous);
  }

  async function handleFile(field: PublicFormField, file: File | undefined) {
    if (!file) return;
    setPageError(null);
    showLocalPreview(field, file);
    const draftState = await ensureDraft();
    if (!draftState?.resume_token || !draftState.draft_id) return;
    setBusy(true);
    try {
      const token = await requestTurnstileToken();
      if (turnstileRequired() && !token) {
        setPageError("The security check did not finish, so the file was not attached. Complete it at the bottom of this form, then choose the file again; your draft is saved.");
        return;
      }
      const signed = await apiFetch<{ attachmentId?: string; completionToken?: string; putUrl?: string; requiredHeaders?: Record<string, string> }>("/api/v1/public/uploads/sign", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draftState.draft_id, resumeToken: draftState.resume_token, fieldKey: field.key, turnstileToken: token, filename: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size }),
        route: "/api/v1/public/uploads/sign",
      });
      if (!signed.attachmentId || !signed.completionToken || !signed.putUrl) throw new Error("The upload sign response was unreadable.");
      await putFileToR2({ putUrl: signed.putUrl, requiredHeaders: signed.requiredHeaders ?? {}, expiresAt: Date.now() + 60_000, completionToken: signed.completionToken, attachmentId: signed.attachmentId, maxBytes: Number.MAX_SAFE_INTEGER }, file).promise;
      await apiFetch<{ url?: string }>(`/api/v1/public/uploads/${encodeURIComponent(signed.attachmentId)}/complete`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ completionToken: signed.completionToken }),
        route: "/api/v1/public/uploads/{id}/complete",
      });
      resetTurnstile();
      setAnswer(field.key, { attachmentId: signed.attachmentId, filename: file.name, contentType: file.type, sizeBytes: file.size });
    } catch (error: unknown) {
      resetTurnstile();
      setPageError(publicErrorMessage(error));
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
      const token = await requestTurnstileToken();
      if (turnstileRequired() && !token) {
        setPageError(SECURITY_CHECK_UNFINISHED);
        return;
      }
      const payload = await apiFetch<PublicFormState>(`/api/v1/public/forms/${encodeURIComponent(state.form.slug)}/submissions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers, resumeToken: state.resume_token ?? undefined, turnstileToken: token }),
        route: "/api/v1/public/forms/{slug}/submissions",
      });
      if (!payload || !("state" in payload)) throw new Error("The submission response was unreadable.");
      removeTurnstile();
      setState(payload);
      setAnswers(payload.answers);
      setDirty(false);
    } catch (error: unknown) {
      resetTurnstile();
      const issues = publicValidationIssues(error);
      if (issues.length) {
        const next: Record<string, string> = {};
        for (const issue of issues) if (issue.fieldKey && issue.message) next[issue.fieldKey] = issue.message;
        setErrors(next);
      }
      setPageError(publicErrorMessage(error));
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
      const acceptList = Array.isArray(field.config.accept) ? field.config.accept.filter((entry): entry is string => typeof entry === "string") : [];
      const accept = acceptList.length ? acceptList.join(",") : undefined;
      const takesImage = acceptList.some((entry) => entry.startsWith("image/") || /^\.?(?:jpe?g|png|webp)$/i.test(entry));
      const preview = filePreviews[field.key];
      // The preview frame and the status line are always rendered, empty or
      // not, so choosing a file never shifts the rows underneath it.
      control = <div class="public-file"><input id={`public-${field.key}`} ref={ref as never} type="file" accept={accept} onChange={(event) => { void handleFile(field, (event.currentTarget as HTMLInputElement).files?.[0]); }} />{takesImage && <div class="public-file-preview"><div class="public-file-crop">{preview ? <img src={preview} alt={`${field.label} crop preview`} /> : null}</div><span class="public-file-crop-note">{preview ? "Crop preview · the square the conference programme shows." : "Choose an image to see its crop preview here."}</span></div>}<span class={`public-file-existing${existing ? " has-file" : ""}`}>{existing ? `Saved file: ${existing}` : "No file attached yet."}</span></div>;
    } else {
      const inputType = field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
      control = <input id={`public-${field.key}`} ref={ref as never} type={inputType} maxLength={maxLength} value={value === undefined || value === null ? "" : String(value)} onBlur={() => { if (dirty) validate(); }} onInput={(event) => { const text = (event.currentTarget as HTMLInputElement).value; setAnswer(field.key, field.type === "number" && text ? Number(text) : text); }} aria-invalid={Boolean(error)} />;
    }
    return <div class={`public-field${error ? " has-error" : ""}`} data-field-key={field.key} data-field-type={field.type} key={field.key}>{label}{note}{control}{counter}<div class={`public-field-error${error ? " has-message" : ""}`} role={error ? "alert" : undefined} aria-hidden={!error}>{error ?? " "}</div></div>;
  }

  const closed = state.state === "closed" || state.state === "at_limit" || state.state === "submitted";
  if (state.state === "submitted" && state.confirmation) {
    return <div class="public-form"><PublicHeader state={state} /><main class="public-form-main"><section class="public-confirmation" aria-live="polite"><div class="public-brand-mark">✓</div><h2>{state.confirmation.title}</h2><p>{state.confirmation.message}</p><p>We will write to <strong>{state.confirmation.email}</strong>.</p>{state.resume_url && <p class="public-resume">Save this link to reopen this confirmation later; the same link is in your confirmation email. <a class="public-resume-link" href={resumeLinkPath(state.resume_url)}>{resumeLinkPath(state.resume_url)}</a></p>}{state.confirmation.portal_url && <p><a href={state.confirmation.portal_url}>Open your speaker portal →</a></p>}</section></main><PublicFooter /></div>;
  }

  const minimumParticipants = state.form.min_speakers === 1 ? "one participant" : `${state.form.min_speakers} participants`;
  const saveStatus = busy
    ? "Saving…"
    : state.resume_token
      ? (dirty ? "Saving…" : state.last_saved_at ? `Saved ${new Date(state.last_saved_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Draft linked")
      : "";
  const resumePath = state.resume_url ? resumeLinkPath(state.resume_url) : null;
  return <div class="public-form" data-public-form><PublicHeader state={state} /><main class="public-form-main"><section class="public-intro"><h1>{state.form.name}</h1><p>{state.form.welcome_md || "Share the idea you want the conference to make room for."}</p><div class="public-meta"><span>{state.conference.name}</span>{state.form.closes_at && <span>{state.state === "closed" ? `Closed ${new Date(state.form.closes_at).toLocaleDateString()}` : `Closes ${new Date(state.form.closes_at).toLocaleDateString()}`}</span>}<span class={`public-save-status${saveStatus ? " has-value" : ""}`} aria-live="polite" aria-hidden={!saveStatus}>{saveStatus}</span></div><div class="public-progress" aria-label="Form progress">{[0, 1, 2, 3, 4].map((step) => <i class={step <= Math.min(4, Math.floor(Object.keys(answers).length / Math.max(1, state.fields.length) * 5)) ? "is-active" : ""} />)}</div></section>{state.message && <div class={`public-notice${closed && state.state !== "submitted" ? " alarm" : ""}`} role="status">{state.message}</div>}<div class={`public-error${pageError ? " has-message" : ""}`} role={pageError ? "alert" : undefined} aria-hidden={!pageError}>{pageError ?? " "}</div><form class="public-form-card" onSubmit={submit}><div class="public-form-card-head"><h2>Abstract details</h2><span class="public-kicker">{visibleFields.length} answers</span></div><p class="public-participant-limit">Include at least {minimumParticipants}; this form has one optional co-speaker slot.</p><fieldset class="public-form-fields" disabled={closed}>{visibleFields.map(renderField)}<div class="public-security"><div class="cf-turnstile" data-sitekey={state.turnstile_site_key ?? ""} ref={(node) => { turnstileHost.current = node as HTMLElement | null; }} dangerouslySetInnerHTML={{ __html: "" }} /><input type="hidden" data-turnstile-token value={turnstileToken} /></div></fieldset>{state.resume_url && <div class="public-draft-resume" role="status"><strong>Private resume link</strong><span>Keep this link to return to this draft. It is also sent to your contact address.</span><div class="public-draft-resume-actions"><a class="public-resume-link" href={resumePath ?? "#"}>{resumePath}</a><button class="public-copy-link" type="button" onClick={() => { void copyResumeLink(); }}>{copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy resume link"}</button></div></div>}<div class="public-form-footer"><div class="public-form-footer-copy">{draftEmailPrompt && !state.resume_token && !closed && <div class="public-draft-email"><label for="public-draft-email">Contact address for your resume link</label><input id="public-draft-email" ref={draftEmailRef} type="email" value={answerEmail(answers)} onInput={(event) => setAnswer("speaker_email", (event.currentTarget as HTMLInputElement).value)} /><span>We will send a private link here so you can return to this draft.</span></div>}<span class="public-security">{closed ? "This form is not accepting answers right now, so its fields are closed for editing." : "Your answers stay here while you work. A resume link goes to the address you enter."}</span></div><div class="public-form-actions"><button class="public-save-draft" type="button" onClick={() => { void saveDraft(); }} disabled={busy || closed}>Save draft</button><button class="public-submit" type="submit" disabled={busy || closed}>{busy ? "Saving…" : "Submit abstract"}</button></div></div></form></main><PublicFooter /></div>;
}

function PublicHeader({ state }: { state: PublicFormState }) {
  return <header class="public-form-header"><div class="public-form-header-inner"><a class="public-brand" href="/"><span class="public-brand-mark">M</span><span class="public-brand-name">Marquee</span></a><span class="public-kicker">{state.conference.name}<br />{closeLabel(state)}</span></div></header>;
}

function PublicFooter() {
  return <footer class="public-footer"><span>Marquee · conference program operations</span><span>Your response is saved with the conference</span></footer>;
}
