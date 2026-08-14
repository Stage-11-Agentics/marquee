import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { describeRejectedEmail, isAllowlistEmail, normalizeAllowlistEmail } from "../../lib/demo-mail-allowlist";

const ALLOWLIST_ROUTE = "/api/v1/events/{eventId}/demo-mail-allowlist";

interface AllowlistData {
  demo_mode: boolean;
  limit: number;
  emails: string[];
}

/** The line under the input always exists; only its words and its tone change. */
type Note = { tone: "hint" | "error" | "saved"; text: string };

const DEFAULT_HINT: Note = {
  tone: "hint",
  text: "A complete address, checked before it is saved. Mail to it is really sent.",
};

function path(eventId: string): string {
  return `/api/v1/events/${encodeURIComponent(eventId)}/demo-mail-allowlist`;
}

/**
 * The one way in to the demo-safe allowlist.
 *
 * A conference in demo mode writes every message to the outbox instead of
 * sending it, which is the right default and stays. That default also makes
 * delivery impossible to show — so a named few addresses are allowed through,
 * and this is where an organizer names them, in the same frame as the outbox
 * that would otherwise hold their mail.
 */
export function DemoMailAllowlist({ eventId }: { eventId: string }): JSX.Element {
  const [emails, setEmails] = useState<string[]>([]);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<Note>(DEFAULT_HINT);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<{ data: AllowlistData }>(path(eventId), { route: ALLOWLIST_ROUTE, credentials: "include" })
      .then((response) => {
        if (cancelled) return;
        setEmails(response.data.emails);
        setLimit(response.data.limit);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setNote({ tone: "error", text: `This list could not be read. ${errorSummary(reason)}` });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId]);

  /**
   * Every edit sends the whole list, so the screen and the stored setting can
   * never disagree about which addresses are live — a per-row write would let
   * a failed remove leave an address receiving mail while the row is gone.
   */
  async function save(next: string[], saved: string): Promise<void> {
    setBusy(true);
    try {
      const response = await apiFetch<{ data: AllowlistData }>(path(eventId), {
        route: ALLOWLIST_ROUTE,
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emails: next }),
      });
      setEmails(response.data.emails);
      setLimit(response.data.limit);
      setNote({ tone: "saved", text: saved });
    } catch (reason: unknown) {
      setNote({ tone: "error", text: errorSummary(reason) });
    } finally {
      setBusy(false);
    }
  }

  function add(event: JSX.TargetedEvent<HTMLFormElement>): void {
    event.preventDefault();
    const candidate = normalizeAllowlistEmail(draft);
    if (!isAllowlistEmail(candidate)) {
      setNote({ tone: "error", text: `${describeRejectedEmail(draft, "That")} is not a complete email address.` });
      input.current?.focus();
      return;
    }
    if (emails.includes(candidate)) {
      setNote({ tone: "error", text: `${candidate} already receives real email.` });
      return;
    }
    if (emails.length >= limit) {
      setNote({ tone: "error", text: `This conference already lists ${limit} addresses. Remove one first.` });
      return;
    }
    setDraft("");
    void save([...emails, candidate], `${candidate} will now receive real email.`);
  }

  function remove(email: string): void {
    void save(emails.filter((entry) => entry !== email), `${email} no longer receives real email. Its mail is held in the outbox.`);
  }

  return <section class="comms-section panel comms-allowlist" aria-labelledby="comms-allowlist-heading">
    <div class="section-heading">
      <div>
        <div class="panel-kicker">Real email</div>
        <h2 id="comms-allowlist-heading">Who actually receives mail</h2>
      </div>
      <span class="section-count tabular">{loading ? "—" : `${emails.length} of ${limit}`}</span>
    </div>
    <p class="allowlist-copy">
      This conference is in demo mode, so every message is written to the outbox below instead of
      being sent — a walkthrough never reaches a real submitter. The addresses listed here are the
      exception: mail addressed to them genuinely leaves the building. Everything else stays held.
    </p>
    <div class="allowlist-body">
      {/* Fixed height, whatever the list holds: adding the first address must
          not push the outbox down the page and removing the last must not pull
          it back up. The reservation lives in `comms.css`. */}
      <div class="allowlist-listing">
        {emails.length === 0
          ? <p class="allowlist-empty reserved-copy">{loading
            ? "Reading which addresses receive real email…"
            : "Nobody receives real email. Every message this conference sends is held in the outbox."}</p>
          : <ul class="allowlist-rows">
            {emails.map((email) => <li class="allowlist-row" key={email}>
              <span class="allowlist-live" title="Mail addressed here is really sent">live</span>
              <span class="allowlist-address" title={email}>{email}</span>
              <span class="allowlist-consequence">receives real email</span>
              <button
                class="allowlist-remove"
                type="button"
                disabled={busy}
                aria-label={`Stop sending real email to ${email}`}
                onClick={() => remove(email)}
              >Remove</button>
            </li>)}
          </ul>}
      </div>
      <form class="allowlist-add" onSubmit={add} noValidate>
        <label class="allowlist-label" for="comms-allowlist-input">Add an address</label>
        <div class="allowlist-entry">
          <input
            id="comms-allowlist-input"
            ref={input}
            type="email"
            autoComplete="off"
            spellcheck={false}
            // The same ceiling the schema enforces, so a monster paste is
            // stopped at the keyboard rather than at the server.
            maxLength={254}
            placeholder="you@example.com"
            value={draft}
            disabled={busy || loading}
            aria-describedby="comms-allowlist-note"
            onInput={(event) => { setDraft(event.currentTarget.value); setNote(DEFAULT_HINT); }}
          />
          <button class="allowlist-submit" type="submit" disabled={busy || loading}>{busy ? "Saving" : "Add"}</button>
        </div>
        <p class={`allowlist-note tone-${note.tone}`} id="comms-allowlist-note" role="status" aria-live="polite">{note.text}</p>
      </form>
    </div>
  </section>;
}
